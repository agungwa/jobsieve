import { config } from "../config";
import { runAtsSource, runSource } from "../ingest/pipeline";
import { arbeitnow } from "../sources/arbeitnow";
import { remotive } from "../sources/remotive";
import { remoteok } from "../sources/remoteok";
import { greenhouse } from "../sources/ats/greenhouse";
import { lever } from "../sources/ats/lever";
import { ashby } from "../sources/ats/ashby";
import { runEmbeddingTick } from "./embedding-worker";
import { sql } from "drizzle-orm";
import { getDb } from "../db/client";
import { jobs } from "../db/schema";

/**
 * In-process scheduler. Uses `setInterval` rather than `Bun.cron` because the
 * in-process `Bun.cron(schedule, handler)` overload is not available in
 * Bun 1.3.x at runtime (only the OS-level path/schedule/title overload is).
 *
 * This is fine for our cadence (sources hourly, embedding worker minutely,
 * cleanup daily) — we don't need real cron precision.
 *
 * Each job is independent and wraps its callback in try/catch so a failure in
 * one (e.g., RemoteOK behind Cloudflare) doesn't disable others.
 */

interface ScheduledJob {
  name: string;
  intervalMs: number;
  timer: ReturnType<typeof setInterval>;
}

const registered: ScheduledJob[] = [];

function parseInterval(cronExpr: string): number {
  // Very small subset: support `* * * * *` (1 min) and `N * * * *` (every N-min
  // when minute is `*/N`). For anything else, default to 1 hour. Source cron
  // values come from config and are intentionally simple.
  const parts = cronExpr.trim().split(/\s+/);
  const minute = parts[0] ?? "*";
  if (minute === "*") return 60_000;
  const stepMatch = minute.match(/^\*\/(\d+)$/);
  if (stepMatch) return Number(stepMatch[1]) * 60_000;
  // Daily at HH:MM (literal minute + literal hour) — approximate as a 24h
  // interval (we don't sync to wall clock).
  const hour = parts[1] ?? "*";
  if (hour !== "*" && !hour.includes("/")) return 24 * 60 * 60_000;
  return 60 * 60_000;
}

function register(name: string, cronExpr: string, fn: () => Promise<void>): void {
  const intervalMs = parseInterval(cronExpr);
  const timer = setInterval(() => {
    fn().catch((err) => console.error(`[cron:${name}] uncaught:`, err));
  }, intervalMs);
  // Don't keep the process alive on the scheduler alone.
  timer.unref?.();
  registered.push({ name, intervalMs, timer });
  console.info(`[scheduler] ${name} every ${Math.round(intervalMs / 1000)}s`);
}

export function startScheduler(): void {
  register("arbeitnow", config.CRON_ARBEITNOW, async () => {
    const r = await runSource(arbeitnow);
    console.info(
      `[cron:arbeitnow] fetched=${r.fetched} error=${r.error ?? "none"}`,
    );
  });

  register("remotive", config.CRON_REMOTIVE, async () => {
    const r = await runSource(remotive);
    console.info(
      `[cron:remotive] fetched=${r.fetched} error=${r.error ?? "none"}`,
    );
  });

  // Best-effort: RemoteOK is behind Cloudflare and often 403s; failures are
  // logged to sources.last_error and retried next tick.
  register("remoteok", config.CRON_REMOTEOK, async () => {
    const r = await runSource(remoteok);
    console.info(
      `[cron:remoteok] fetched=${r.fetched} error=${r.error ?? "none"}`,
    );
  });

  register("greenhouse", config.CRON_GREENHOUSE, async () => {
    const r = await runAtsSource(greenhouse);
    console.info(
      `[cron:greenhouse] boards=${r.boards} fetched=${r.fetched} error=${r.error ?? "none"}`,
    );
  });

  register("lever", config.CRON_LEVER, async () => {
    const r = await runAtsSource(lever);
    console.info(
      `[cron:lever] boards=${r.boards} fetched=${r.fetched} error=${r.error ?? "none"}`,
    );
  });

  register("ashby", config.CRON_ASHBY, async () => {
    const r = await runAtsSource(ashby);
    console.info(
      `[cron:ashby] boards=${r.boards} fetched=${r.fetched} error=${r.error ?? "none"}`,
    );
  });

  register("embedding-worker", config.EMBEDDING_WORKER_INTERVAL_CRON, async () => {
    const r = await runEmbeddingTick();
    if (r.embedded > 0 || r.failed > 0) {
      console.info(
        `[cron:embedding-worker] embedded=${r.embedded} cached=${r.cached} failed=${r.failed}`,
      );
    }
  });

  register("cleanup", config.CRON_CLEANUP, async () => {
    const db = await getDb();
    const staleBefore = new Date(
      Date.now() - config.JOB_STALENESS_DAYS * 86_400_000,
    );
    const result = await db
      .delete(jobs)
      .where(sql`${jobs.lastSeenAt} < ${staleBefore}`)
      .returning({ id: jobs.id });
    console.info(`[cron:cleanup] removed ${result.length} stale jobs`);
  });
}

export function stopScheduler(): void {
  for (const job of registered) clearInterval(job.timer);
  registered.length = 0;
}
