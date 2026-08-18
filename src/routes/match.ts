import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getDb, getRawClient } from "../db/client";
import { cvProfiles } from "../db/schema";
import { config } from "../config";
import { NotFoundError, ValidationError } from "../errors";
import type { RoleContext } from "../middleware/admin";

export const matchRouter = new Hono<RoleContext>();

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

/**
 * GET /match?cv_id=<id>&limit=N
 *
 * Returns the top-N jobs ranked by cosine similarity to the CV's embedding.
 * Uses pgvector's `<=>` (cosine distance) operator and the HNSW index.
 * Zero LLM calls.
 *
 * Optional filters: `remote=true`, `skill=Go` (repeatable), `salary_min=100000`.
 */
matchRouter.get("/match", async (c) => {
  const cvId = c.req.query("cv_id");
  if (!cvId) {
    throw new ValidationError("cv_id is required", { field: "cv_id" });
  }
  const limit = Math.min(
    parseInt(c.req.query("limit") ?? "", 10) || DEFAULT_LIMIT,
    MAX_LIMIT,
  );
  const remote = c.req.query("remote");
  const skills = c.req.query("skill")
    ? Array.isArray(c.req.query("skill"))
      ? (c.req.query("skill") as unknown as string[])
      : [c.req.query("skill") as string]
    : [];
  const salaryMin = c.req.query("salary_min")
    ? parseInt(c.req.query("salary_min") as string, 10)
    : null;

  const db = await getDb();
  // Validate CV is embedded.
  const cvRow = await db
    .select({ id: cvProfiles.id, embeddingStatus: cvProfiles.embeddingStatus })
    .from(cvProfiles)
    .where(sql`${cvProfiles.id} = ${cvId}::uuid`)
    .limit(1);
  if (!cvRow[0]) {
    throw new NotFoundError("cv", cvId);
  }
  if (cvRow[0].embeddingStatus !== "embedded") {
    throw new ValidationError(
      `CV is not embedded yet (status: ${cvRow[0].embeddingStatus}). Try again shortly.`,
      { cv_id: cvId, status: cvRow[0].embeddingStatus },
    );
  }

  const staleBefore = new Date(
    Date.now() - config.JOB_STALENESS_DAYS * 86_400_000,
  );

  // Build positional-param query (postgres.js `unsafe` only accepts $1..$N).
  const params: unknown[] = [cvId, staleBefore.toISOString()];
  let paramIdx = 3; // next position after $1 (cvId) and $2 (staleBefore)
  const conds: string[] = [
    `j.embedding IS NOT NULL`,
    `j.embedding_status = 'embedded'`,
    `j.last_seen_at >= $2`,
  ];
  if (remote === "true") conds.push(`j.remote_allowed = 1`);
  if (remote === "false") conds.push(`j.remote_allowed = 0`);
  if (salaryMin !== null && !Number.isNaN(salaryMin)) {
    conds.push(`j.salary_max >= $${paramIdx++}`);
    params.push(salaryMin);
  }
  for (const skill of skills) {
    conds.push(
      `EXISTS (SELECT 1 FROM job_skills js WHERE js.job_id = j.id AND lower(js.skill) = lower($${paramIdx++}))`,
    );
    params.push(skill);
  }
  params.push(limit);
  const limitParam = paramIdx++;

  const raw = await getRawClient();
  const query = `
    SELECT
      j.id, j.title, j.company, j.location, j.remote_allowed AS "remoteAllowed",
      j.seniority, j.salary_min AS "salaryMin", j.salary_max AS "salaryMax",
      j.salary_currency AS "salaryCurrency", j.summary, j.url,
      j.posted_at AS "postedAt",
      1 - (j.embedding <=> (SELECT embedding FROM cv_profiles WHERE id = $1::uuid)) AS score
    FROM jobs j
    WHERE ${conds.join(" AND ")}
    ORDER BY j.embedding <=> (SELECT embedding FROM cv_profiles WHERE id = $1::uuid)
    LIMIT $${limitParam}
  `;
  const rows = (await raw.unsafe(query, params as never[])) as Array<
    Record<string, unknown>
  >;
  return c.json({
    items: rows.map((r) => ({
      ...r,
      score: typeof r.score === "number" ? Math.round(r.score * 1000) / 1000 : r.score,
    })),
    cv_id: cvId,
  });
});
