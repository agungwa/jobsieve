import { Hono } from "hono";
import { desc, eq, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { companies, jobs } from "../db/schema";
import { ValidationError } from "../errors";
import { requireAdmin } from "../middleware/admin";
import type { RoleContext } from "../middleware/admin";

export const adminRouter = new Hono<RoleContext>()

  /**
   * POST /admin/companies — register an ATS board (admin only).
   * Body: { name, ats_type: "greenhouse"|"lever"|"ashby", board_slug, enabled? }
   * Idempotent on (name, ats_type).
   */
  .post("/admin/companies", async (c) => {
    requireAdmin(c);

    let body: Record<string, unknown>;
    try {
      body = (await c.req.json()) as Record<string, unknown>;
    } catch {
      throw new ValidationError("invalid JSON body");
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    const boardSlug = typeof body.board_slug === "string" ? body.board_slug.trim() : "";
    const atsType = typeof body.ats_type === "string" ? body.ats_type : "";
    const hqLocation = typeof body.hq_location === "string" && body.hq_location.trim()
      ? body.hq_location.trim().slice(0, 200)
      : null;
    const enabled = body.enabled === false ? 0 : 1;

    if (!name || name.length > 200) {
      throw new ValidationError("name is required (max 200 chars)", { field: "name" });
    }
    if (!boardSlug || boardSlug.length > 200) {
      throw new ValidationError("board_slug is required", { field: "board_slug" });
    }
    if (!["greenhouse", "lever", "ashby"].includes(atsType)) {
      throw new ValidationError("ats_type must be greenhouse, lever, or ashby", {
        field: "ats_type",
      });
    }

    const db = await getDb();
    const [row] = await db
      .insert(companies)
      .values({
        name,
        atsType: atsType as "greenhouse" | "lever" | "ashby",
        boardSlug,
        hqLocation,
        enabled: enabled as 0 | 1,
      })
      .onConflictDoUpdate({
        target: [companies.name, companies.atsType],
        set: { boardSlug, hqLocation, enabled: enabled as 0 | 1, updatedAt: new Date() },
      })
      .returning();

    return c.json(row, 201);
  })

  /**
   * GET /admin/companies — list registered boards with their job counts.
   */
  .get("/admin/companies", async (c) => {
    requireAdmin(c);
    const db = await getDb();
    const rows = await db
      .select({
        id: companies.id,
        name: companies.name,
        atsType: companies.atsType,
        boardSlug: companies.boardSlug,
        hqLocation: companies.hqLocation,
        enabled: companies.enabled,
        updatedAt: companies.updatedAt,
        jobCount: sql<number>`(
          SELECT count(*)::int FROM job_sources js
          JOIN jobs j ON j.id = js.job_id
          WHERE js.source = ${companies.atsType} || ':' || ${companies.boardSlug}
        )`,
      })
      .from(companies)
      .orderBy(desc(companies.updatedAt));
    return c.json({ items: rows });
  })

  /**
   * DELETE /admin/companies/:id — disable (soft) or hard-delete a board.
   * Query ?hard=true removes the row; default just sets enabled=0.
   */
  .delete("/admin/companies/:id", async (c) => {
    requireAdmin(c);
    const id = c.req.param("id");
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      throw new ValidationError("invalid company id", { field: "id" });
    }
    const db = await getDb();
    if (c.req.query("hard") === "true") {
      const deleted = await db
        .delete(companies)
        .where(eq(companies.id, id))
        .returning({ id: companies.id });
      if (deleted.length === 0) {
        return c.json({ error: "not_found", resource: "company", id }, 404);
      }
      return c.json({ deleted: id });
    }
    const updated = await db
      .update(companies)
      .set({ enabled: 0, updatedAt: new Date() })
      .where(eq(companies.id, id))
      .returning({ id: companies.id });
    if (updated.length === 0) {
      return c.json({ error: "not_found", resource: "company", id }, 404);
    }
    return c.json({ disabled: id });
  })

  /**
   * GET /admin/stats — quick dashboard numbers.
   */
  .get("/admin/stats", async (c) => {
    requireAdmin(c);
    const db = await getDb();
    const [jobStats] = await db
      .select({
        total: sql<number>`count(*)::int`,
        embedded: sql<number>`count(*) FILTER (WHERE embedding_status = 'embedded')::int`,
        pending: sql<number>`count(*) FILTER (WHERE embedding_status = 'pending')::int`,
      })
      .from(jobs);
    return c.json({ jobs: jobStats });
  });
