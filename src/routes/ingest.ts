import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { config } from "../config";
import { isAdminKey } from "../config";
import { runAtsSource, runSource } from "../ingest/pipeline";
import { runEmbeddingTick } from "../scheduler/embedding-worker";
import { arbeitnow } from "../sources/arbeitnow";
import { remotive } from "../sources/remotive";
import { remoteok } from "../sources/remoteok";
import { adzuna } from "../sources/adzuna";
import { greenhouse } from "../sources/ats/greenhouse";
import { lever } from "../sources/ats/lever";
import { ashby } from "../sources/ats/ashby";
import type { RoleContext } from "../middleware/admin";

export const ingestRouter = new Hono<RoleContext>();

/**
 * POST/GET /ingest — full ingest run for Vercel cron (serverless has no
 * long-running scheduler).
 *
 * Free-tier limitation handling:
 *   - Function duration is capped (60s Hobby). This endpoint works in a
 *     self-continuing loop: ingest sources once, then drain the embedding
 *     queue in ticks until the time budget is nearly spent.
 *   - If embeddings remain, it re-invokes itself once via VERCEL_URL so the
 *     next function instance continues where this one stopped.
 *   - Repeat calls within a run are cheap: after the first invocation the
 *     sources are skipped unless ?full=1 (embed-only continuation).
 *
 * Auth: x-api-key (admin) or ?secret=CRON_SECRET (Vercel cron).
 */
ingestRouter.all("/ingest", async (c) => {
  const key = c.req.header("x-api-key");
  const bearer = c.req.header("authorization");
  const secret = c.req.query("secret");
  const cronOk =
    config.CRON_SECRET &&
    (secret === config.CRON_SECRET ||
      bearer === `Bearer ${config.CRON_SECRET}`);
  if (!(key && isAdminKey(key)) && !cronOk) {
    return c.json({ error: "forbidden" }, 403);
  }

  const full = c.req.query("full") === "1";
  const skipSources = c.req.query("embed_only") === "1";
  const budgetMs = config.INGEST_TIME_BUDGET_MS;
  const startedAt = Date.now();

  interface Summary {
    sources: Array<{ name: string; fetched?: number; boards?: number; error: string | null }>;
    embedded: { ticks: number; processed: number; embedded: number; cached: number; failed: number };
    pendingEmbeddings: number;
    continued: boolean;
    durationMs: number;
  }
  const summary: Summary = {
    sources: [],
    embedded: { ticks: 0, processed: 0, embedded: 0, cached: 0, failed: 0 },
    pendingEmbeddings: 0,
    continued: false,
    durationMs: 0,
  };

  // 1. Ingest sources (skipped on continuation invocations).
  if (!skipSources || full) {
    const simple = [
      ["arbeitnow", () => runSource(arbeitnow)],
      ["remotive", () => runSource(remotive)],
      ["remoteok", () => runSource(remoteok)],
      ["adzuna", () => runSource(adzuna)],
    ] as const;
    for (const [name, run] of simple) {
      const r = await run();
      summary.sources.push({ name, fetched: r.fetched, error: r.error });
    }
    const ats = [
      ["greenhouse", () => runAtsSource(greenhouse as never)],
      ["lever", () => runAtsSource(lever as never)],
      ["ashby", () => runAtsSource(ashby as never)],
    ] as const;
    for (const [name, run] of ats) {
      const r = await run();
      summary.sources.push({ name, boards: r.boards, fetched: r.fetched, error: r.error });
    }
  }

  // 2. Drain the embedding queue within the remaining time budget.
  const reserveMs = 3_000; // headroom for response + self-invocation
  const tickStats = summary.embedded;
  while (Date.now() - startedAt < budgetMs - reserveMs) {
    const tick = await runEmbeddingTick();
    tickStats.ticks++;
    tickStats.processed += tick.processed;
    tickStats.embedded += tick.embedded;
    tickStats.cached += tick.cached;
    tickStats.failed += tick.failed;
    if (tick.processed === 0) break; // queue drained
  }

  // 3. Count what's left; re-invoke ourselves if the budget ran out.
  const db = await getDb();
  const pending = (await db.execute(
    sql`SELECT ((SELECT count(*) FROM jobs WHERE embedding_status = 'pending')
             + (SELECT count(*) FROM cv_profiles WHERE embedding_status = 'pending'))::int AS n`,
  )) as unknown as Array<{ n: number }>;
  summary.pendingEmbeddings = pending[0]?.n ?? 0;

  if (summary.pendingEmbeddings > 0 && tickStats.ticks > 0 && config.VERCEL_URL) {
    // Await the continuation request (bounded) — serverless kills in-flight
    // work when the function returns, so fire-and-forget is unreliable.
    const url = `https://${config.VERCEL_URL}/api/ingest?embed_only=1${
      config.CRON_SECRET ? `&secret=${encodeURIComponent(config.CRON_SECRET)}` : ""
    }`;
    await Promise.race([
      fetch(url, { method: "POST" }).catch(() => {}),
      new Promise((r) => setTimeout(r, 5_000)),
    ]);
    summary.continued = true;
  }

  summary.durationMs = Date.now() - startedAt;
  return c.json(summary);
});
