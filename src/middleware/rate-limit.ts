import type { Context, Next } from "hono";
import { sql } from "drizzle-orm";
import { config } from "../config";
import { getDb } from "../db/client";

/**
 * Per-userKey rate limit for LLM-backed endpoints, backed by Postgres so it
 * works on serverless (in-memory windows are per-instance and useless when
 * Vercel spawns concurrent functions).
 *
 * Sliding window: count rows in the last 24h for the key; insert a hit when
 * allowed. Stale rows for the key are pruned on every check, so no separate
 * cleanup job is needed at this volume.
 */

const WINDOW_SEC = 24 * 60 * 60;

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  retryAfterSec: number;
}

export async function checkRateLimit(userKey: string): Promise<RateLimitResult> {
  const db = await getDb();

  // Prune stale hits for this key, then count the active window.
  await db.execute(
    sql`DELETE FROM rate_limit_hits
        WHERE user_key = ${userKey} AND hit_at < now() - interval '25 hours'`,
  );
  const rows = (await db.execute(
    sql`SELECT count(*)::int AS n, min(hit_at) AS oldest
        FROM rate_limit_hits WHERE user_key = ${userKey}`,
  )) as unknown as Array<{ n: number; oldest: string | null }>;

  const count = rows[0]?.n ?? 0;
  if (count >= config.RATE_LIMIT_PER_DAY) {
    const oldest = rows[0]?.oldest ? new Date(rows[0].oldest).getTime() : Date.now();
    const retryAfterSec = Math.max(1, Math.ceil((oldest + WINDOW_SEC * 1000 - Date.now()) / 1000));
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  await db.execute(
    sql`INSERT INTO rate_limit_hits (user_key, hit_at) VALUES (${userKey}, now())
        ON CONFLICT DO NOTHING`,
  );

  return {
    allowed: true,
    remaining: config.RATE_LIMIT_PER_DAY - count - 1,
    retryAfterSec: 0,
  };
}

/** Hono middleware for /chat. Admin and BYOK users bypass; anon gets 429. */
export async function chatRateLimit(c: Context, next: Next) {
  // BYOK: the caller supplies their own AI key → their cost, no daily cap.
  if (c.get("role") === "admin" || c.req.header("x-glm-key")) {
    await next();
    return;
  }
  const userKey = c.get("userKey") ?? "anon";
  const result = await checkRateLimit(userKey);
  if (!result.allowed) {
    c.header("retry-after", String(result.retryAfterSec));
    return c.json(
      {
        error: "rate_limited",
        message: `Daily limit of ${config.RATE_LIMIT_PER_DAY} messages reached. Try again in ${result.retryAfterSec}s or provide an admin key.`,
        retryAfterSec: result.retryAfterSec,
      },
      429,
    );
  }
  c.header("x-ratelimit-remaining", String(result.remaining));
  await next();
}

/** Test hook: reset a user's window. */
export async function resetRateLimit(userKey: string): Promise<void> {
  const db = await getDb();
  await db.execute(sql`DELETE FROM rate_limit_hits WHERE user_key = ${userKey}`);
}
