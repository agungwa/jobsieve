import type { Context } from "hono";
import { createMiddleware } from "hono/factory";
import { sql } from "drizzle-orm";
import { config, isAdminKey } from "../config";
import { getDb } from "../db/client";
import { ForbiddenError } from "../errors";

export type RoleContext = {
  Variables: {
    role: "admin" | "anon";
    userKey: string;
    reqId?: string;
  };
};

const ADMIN_FAIL_LIMIT = 10; // per IP per hour
const ADMIN_FAIL_WINDOW = "1 hour";

/**
 * Sets `role` ("admin" | "anon") on the context based on the `x-api-key` header.
 * Always succeeds for valid/absent keys — admin gating happens at the route
 * level. A *present but wrong* key is treated as a failed admin attempt:
 * after ADMIN_FAIL_LIMIT failures per IP per hour, further attempts are
 * locked out with 429 (brute-force protection for public deployments).
 */
export const identifyRole = createMiddleware<RoleContext>(async (c, next) => {
  const key = c.req.header("x-api-key");
  const ipKey = `ip:${await hashIp(c)}`;
  if (!key || isAdminKey(key)) {
    c.set("role", key ? "admin" : "anon");
    c.set("userKey", key ? "admin" : ipKey);
    await next();
    return;
  }

  // Wrong key → count it and possibly lock out.
  const db = await getDb();
  const failKey = `adminfail:${ipKey}`;
  await db.execute(
    sql`INSERT INTO rate_limit_hits (user_key, hit_at) VALUES (${failKey}, now())
        ON CONFLICT DO NOTHING`,
  );
  const rows = (await db.execute(
    sql`SELECT count(*)::int AS n FROM rate_limit_hits
        WHERE user_key = ${failKey} AND hit_at > now() - interval '${sql.raw(ADMIN_FAIL_WINDOW)}'`,
  )) as unknown as Array<{ n: number }>;

  if ((rows[0]?.n ?? 0) > ADMIN_FAIL_LIMIT) {
    return c.json(
      { error: "rate_limited", message: "Too many failed attempts. Try again later." },
      429,
    );
  }

  c.set("role", "anon");
  c.set("userKey", ipKey);
  await next();
});

async function hashIp(c: Context): Promise<string> {
  const ip =
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    "unknown";
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${ip}:${config.ADMIN_API_KEY.length}`),
  );
  return Array.from(new Uint8Array(buf))
    .slice(0, 8)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Gate a handler to admin role only. Throws 403 for anon. */
export function requireAdmin(c: Context): void {
  if (c.get("role") !== "admin") {
    throw new ForbiddenError();
  }
}
