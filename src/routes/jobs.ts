import { Hono } from "hono";
import { and, desc, eq, gte, ilike, inArray, or, sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { jobs, jobSkills } from "../db/schema";
import { config } from "../config";
import { NotFoundError } from "../errors";
import type { RoleContext } from "../middleware/admin";

export const jobsRouter = new Hono<RoleContext>();

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

/**
 * GET /jobs
 *
 * Query params:
 *   limit         (default 20, max 100)
 *   cursor        (keyset pagination token — ISO posted_at + id)
 *   q             (ILIKE title+company+summary)
 *   company
 *   location      (ILIKE location)
 *   workplace     ("remote" | "hybrid" | "onsite" — derived from remote flag + location text)
 *   remote        ("true" | "false" — legacy, same as workplace=remote)
 *   seniority     (comma-separated: intern,junior,mid,senior,lead,staff,manager,director+)
 *   salary_min    (integer — jobs whose salary_max >= this)
 *   posted_within (days — posted_at >= now - N days)
 *   visa          ("true" — description mentions visa sponsorship / relocation)
 *   source        (e.g. arbeitnow, greenhouse — via job_sources)
 *   skill         (repeatable; AND)
 */
jobsRouter.get("/jobs", async (c) => {
  const q = c.req.query();
  const limit = Math.min(parseInt(q.limit ?? "", 10) || DEFAULT_LIMIT, MAX_LIMIT);
  const cursor = q.cursor;
  const staleBefore = new Date(Date.now() - config.JOB_STALENESS_DAYS * 86_400_000);

  const db = await getDb();

  // Build WHERE conditions. Always exclude stale + non-embedded jobs.
  const conds = [
    gte(jobs.lastSeenAt, staleBefore),
    eq(jobs.embeddingStatus, "embedded"),
  ];

  if (q.company) conds.push(eq(jobs.company, q.company));
  if (q.location) conds.push(ilike(jobs.location, `%${q.location}%`));
  if (q.remote === "true") conds.push(eq(jobs.remoteAllowed, 1));
  if (q.remote === "false") conds.push(eq(jobs.remoteAllowed, 0));

  // Workplace type. Derived: remote flag OR location text; hybrid/onsite from
  // location text (most boards put "Hybrid - London" / "Remote in Europe").
  if (q.workplace === "remote") {
    conds.push(or(eq(jobs.remoteAllowed, 1), ilike(jobs.location, "%remote%"))!);
  } else if (q.workplace === "hybrid") {
    conds.push(ilike(jobs.location, "%hybrid%"));
  } else if (q.workplace === "onsite") {
    conds.push(
      and(
        or(sql`${jobs.remoteAllowed} IS NULL`, eq(jobs.remoteAllowed, 0))!,
        or(sql`${jobs.location} IS NULL`, sql`${jobs.location} NOT ILIKE '%remote%'`)!,
        or(sql`${jobs.location} IS NULL`, sql`${jobs.location} NOT ILIKE '%hybrid%'`)!,
      )!,
    );
  }

  if (q.seniority) {
    const list = q.seniority.split(",").map((s) => s.trim()).filter(Boolean);
    if (list.length > 0) conds.push(inArray(jobs.seniority, list));
  }

  if (q.salary_min) {
    const min = parseInt(q.salary_min, 10);
    if (!Number.isNaN(min)) conds.push(gte(jobs.salaryMax, min));
  }

  if (q.posted_within) {
    const days = parseInt(q.posted_within, 10);
    if (!Number.isNaN(days) && days > 0) {
      conds.push(gte(jobs.postedAt, new Date(Date.now() - days * 86_400_000)));
    }
  }

  if (q.visa === "true") {
    conds.push(
      or(
        ilike(jobs.description, "%visa sponsorship%"),
        ilike(jobs.description, "%sponsorship%"),
        ilike(jobs.description, "%visa%"),
        ilike(jobs.description, "%relocation%"),
      )!,
    );
  }

  if (q.source) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM job_sources s WHERE s.job_id = ${jobs.id} AND s.source = ${q.source})`,
    );
  }

  if (q.q) {
    const term = `%${q.q}%`;
    conds.push(
      or(
        ilike(jobs.title, term),
        ilike(jobs.company, term),
        ilike(jobs.summary, term),
      )!,
    );
  }

  // Keyset cursor: "(posted_at, id) < cursor" for DESC ordering.
  if (cursor) {
    const [postedAt, id] = cursor.split("|");
    if (postedAt && id) {
      conds.push(
        sql`(${jobs.postedAt}, ${jobs.id}) < (${postedAt}, ${id}::uuid)`,
      );
    }
  }

  // Skill AND-filter: push down to SQL as EXISTS subqueries.
  const skillFilter = q.skill
    ? Array.isArray(q.skill)
      ? q.skill
      : [q.skill]
    : [];
  for (const skill of skillFilter) {
    conds.push(
      sql`EXISTS (SELECT 1 FROM job_skills js WHERE js.job_id = ${jobs.id} AND lower(js.skill) = lower(${skill}))`,
    );
  }

  const rows = await db
    .select({
      id: jobs.id,
      title: jobs.title,
      company: jobs.company,
      location: jobs.location,
      remoteAllowed: jobs.remoteAllowed,
      seniority: jobs.seniority,
      salaryMin: jobs.salaryMin,
      salaryMax: jobs.salaryMax,
      salaryCurrency: jobs.salaryCurrency,
      summary: jobs.summary,
      url: jobs.url,
      postedAt: jobs.postedAt,
      sources: sql<string[]>`(
        SELECT coalesce(array_agg(s.source), '{}') FROM job_sources s WHERE s.job_id = ${jobs.id}
      )`,
    })
    .from(jobs)
    .where(and(...conds))
    .orderBy(desc(jobs.postedAt), desc(jobs.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const nextCursor =
    hasMore && page.length > 0
      ? `${page[page.length - 1]!.postedAt?.toISOString() ?? ""}|${page[page.length - 1]!.id}`
      : null;

  return c.json({ items: page, cursor: nextCursor });
});

/**
 * GET /suggest — autocomplete values for search/filter inputs.
 * Query: field ("q" | "company" | "location" | "skill"), prefix (min 2 chars)
 */
jobsRouter.get("/suggest", async (c) => {
  const field = c.req.query("field") ?? "q";
  const prefix = (c.req.query("prefix") ?? "").trim();
  if (prefix.length < 2) return c.json({ items: [] });
  const like = `%${prefix}%`;

  const db = await getDb();
  let items: string[] = [];

  if (field === "location") {
    const res = (await db.execute(
      sql`SELECT location FROM jobs
          WHERE location ILIKE ${like} AND location IS NOT NULL
          GROUP BY location ORDER BY count(*) DESC LIMIT 8`,
    )) as unknown as Array<{ location: string }>;
    items = res.map((r) => r.location);
  } else if (field === "skill") {
    const res = (await db.execute(
      sql`SELECT skill FROM job_skills
          WHERE lower(skill) LIKE lower(${like})
          GROUP BY skill ORDER BY count(*) DESC LIMIT 8`,
    )) as unknown as Array<{ skill: string }>;
    items = res.map((r) => r.skill);
  } else if (field === "company") {
    const res = (await db.execute(
      sql`SELECT company FROM jobs
          WHERE company ILIKE ${like} GROUP BY company ORDER BY count(*) DESC LIMIT 8`,
    )) as unknown as Array<{ company: string }>;
    items = res.map((r) => r.company);
  } else {
    // Default "q": titles + companies.
    const res = (await db.execute(
      sql`(SELECT title AS v FROM jobs WHERE title ILIKE ${like} GROUP BY title LIMIT 8)
          UNION
          (SELECT company FROM jobs WHERE company ILIKE ${like} GROUP BY company LIMIT 8)
          LIMIT 8`,
    )) as unknown as Array<{ v: string }>;
    items = res.map((r) => r.v);
  }

  return c.json({ items });
});

/**
 * GET /jobs/:id
 */
jobsRouter.get("/jobs/:id", async (c) => {
  const id = c.req.param("id");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    throw new NotFoundError("job", id);
  }
  const db = await getDb();
  const row = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!row[0]) {
    throw new NotFoundError("job", id);
  }
  const skillRows = await db
    .select({ skill: jobSkills.skill })
    .from(jobSkills)
    .where(eq(jobSkills.jobId, id));
  return c.json({ ...row[0], skills: skillRows.map((s) => s.skill) });
});
