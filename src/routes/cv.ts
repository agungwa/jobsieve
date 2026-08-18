import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { eq } from "drizzle-orm";
import { getDb } from "../db/client";
import { cvProfiles, cvSkills } from "../db/schema";
import { config } from "../config";
import { ParseError } from "../errors";
import type { RoleContext } from "../middleware/admin";
import { extractContacts } from "../cv/contact";
import { splitSections } from "../cv/sections";
import { extractSkills } from "../cv/skills";
import { estimateYearsExperience, guessTargetRole } from "../cv/experience";
import { extractorFor } from "../cv/extract";
import { runEmbeddingTick } from "../scheduler/embedding-worker";

const MAX_BYTES = config.CV_MAX_BYTES;

export const cvRouter = new Hono<RoleContext>()

  /**
   * POST /cv — multipart upload (field "file"), deterministic parse, zero AI.
   * 415 unsupported type, 413 oversize, 422 unparseable/empty text.
   */
  .post("/cv", async (c) => {
    const contentLength = Number(c.req.header("content-length") ?? 0);
    if (contentLength > MAX_BYTES) {
      return c.json(
        { error: "payload_too_large", maxBytes: MAX_BYTES },
        413,
      );
    }

    let file: File;
    try {
      const body = await c.req.parseBody();
      const candidate = body["file"];
      if (!(candidate instanceof File)) {
        return c.json({ error: "validation_error", message: 'multipart field "file" is required' }, 400);
      }
      file = candidate;
    } catch {
      return c.json({ error: "validation_error", message: "invalid multipart body" }, 400);
    }

    if (file.size > MAX_BYTES) {
      return c.json({ error: "payload_too_large", maxBytes: MAX_BYTES, size: file.size }, 413);
    }

    const filename = file.name || "cv";
    const contentType = file.type || "";
    const buffer = Buffer.from(await file.arrayBuffer());

    // Type gate → 415 on unsupported.
    let extractor;
    try {
      extractor = extractorFor(contentType, filename);
    } catch {
      return c.json(
        { error: "unsupported_media_type", contentType, filename },
        415,
      );
    }

    // Extraction → 422 on failure (ParseError propagates to errorHandler).
    const rawText = (await extractor.extract(buffer)).trim();
    if (rawText.length < 40) {
      throw new ParseError("CV text is empty or too short to parse", { format: "pdf" });
    }

    // Deterministic parse. Zero AI.
    const sections = splitSections(rawText);
    const contacts = extractContacts(rawText);
    const skills = extractSkills(rawText);
    const years = estimateYearsExperience(sections);
    const targetRole = guessTargetRole(sections, rawText);

    if (sections.length === 0 || (skills.length === 0 && years === null && targetRole === null)) {
      throw new ParseError("Document does not look like a CV (no sections or signals found)");
    }

    // Serverless disks are ephemeral — only parsed text is persisted.
    const id = randomUUID();
    const rawBytesRef = null;

    const db = await getDb();
    const [profile] = await db
      .insert(cvProfiles)
      .values({
        id,
        filename,
        contentType: contentType || "application/octet-stream",
        rawBytesRef,
        rawText,
        contacts: contacts as unknown as never,
        sections: sections as unknown as never,
        skills: skills.map(({ skill, occurrences }) => ({ skill, occurrences })) as unknown as never,
        estimatedYearsExperience: years,
        targetRole,
      })
      .returning({
        id: cvProfiles.id,
        filename: cvProfiles.filename,
        embeddingStatus: cvProfiles.embeddingStatus,
        createdAt: cvProfiles.createdAt,
      });

    if (skills.length > 0) {
      await db
        .insert(cvSkills)
        .values(
          skills.map((s) => ({ cvId: id, skill: s.skill, occurrences: s.occurrences })),
        )
        .onConflictDoNothing();
    }

    // Embed inline (one vector via the embedding provider — a single fast
    // call). Serverless functions can't reliably do work after the response,
    // so we await; on failure the row stays 'pending' for the ingest cron.
    let status = profile!.embeddingStatus;
    try {
      await runEmbeddingTick();
      const [fresh] = await db
        .select({ embeddingStatus: cvProfiles.embeddingStatus })
        .from(cvProfiles)
        .where(eq(cvProfiles.id, id))
        .limit(1);
      status = fresh?.embeddingStatus ?? status;
    } catch (err) {
      console.error("[cv] inline embedding failed:", (err as Error).message);
    }

    return c.json(
      {
        id: profile!.id,
        filename: profile!.filename,
        embeddingStatus: status,
        skillsFound: skills.length,
        estimatedYearsExperience: years,
        targetRole,
        createdAt: profile!.createdAt,
      },
      201,
    );
  })

  /**
   * GET /cv/:id — structured profile only (no raw bytes / raw text).
   */
  .get("/cv/:id", async (c) => {
    const id = c.req.param("id");
    const uuidOk =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if (!uuidOk) {
      return c.json({ error: "not_found", resource: "cv", id }, 404);
    }

    const db = await getDb();
    const [row] = await db
      .select({
        id: cvProfiles.id,
        filename: cvProfiles.filename,
        contentType: cvProfiles.contentType,
        contacts: cvProfiles.contacts,
        sections: cvProfiles.sections,
        skills: cvProfiles.skills,
        estimatedYearsExperience: cvProfiles.estimatedYearsExperience,
        targetRole: cvProfiles.targetRole,
        embeddingStatus: cvProfiles.embeddingStatus,
        createdAt: cvProfiles.createdAt,
        updatedAt: cvProfiles.updatedAt,
      })
      .from(cvProfiles)
      .where(eq(cvProfiles.id, id));

    if (!row) {
      return c.json({ error: "not_found", resource: "cv", id }, 404);
    }

    return c.json(row);
  });
