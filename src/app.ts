import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config";
import { getRawClient } from "./db/client";
import { identifyRole, type RoleContext } from "./middleware/admin";
import { errorHandler } from "./middleware/error";
import { jobsRouter } from "./routes/jobs";
import { sourcesRouter } from "./routes/sources";
import { matchRouter } from "./routes/match";
import { glmPing } from "./ai/glm";
import { cvRouter } from "./routes/cv";
import { adminRouter } from "./routes/admin";
import { chatRouter } from "./routes/chat";
import { ingestRouter } from "./routes/ingest";

/**
 * The Hono app, free of any runtime-specific APIs (no Bun.serve, no
 * filesystem static serving) so it can run on Bun locally and in a Vercel
 * serverless function via `hono/vercel`. Runtime glue lives in src/index.ts
 * (Bun) and api/index.ts (Vercel).
 */
export const app = new Hono<RoleContext>()
  .use("*", cors())
  .use("*", identifyRole)
  .use("*", async (c, next) => {
    const reqId = crypto.randomUUID().slice(0, 8);
    const start = Date.now();
    c.set("reqId", reqId);
    await next();
    const line = {
      ts: new Date().toISOString(),
      level: "info",
      reqId,
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      durationMs: Date.now() - start,
      role: c.get("role"),
    };
    if (c.req.path === "/healthz") return;
    if (c.res.status >= 500) console.error(JSON.stringify(line));
    else console.info(JSON.stringify(line));
  })
  .onError(errorHandler)
  .notFound((c) =>
    c.json({ error: "not_found", path: c.req.path }, 404),
  )
  .get("/healthz", async (c) => {
    const checks: Record<string, "ok" | "error" | string> = {};

    // DB ping.
    try {
      const raw = await getRawClient();
      await raw`SELECT 1`;
      checks.db = "ok";
    } catch (err) {
      checks.db = (err as Error).message;
    }

    // GLM ping (cached for 60s so uptime monitors don't hammer it).
    checks.glm = await glmHealth();

    const healthy = Object.values(checks).every((v) => v === "ok");
    return c.json(
      { status: healthy ? "ok" : "degraded", ...checks },
      healthy ? 200 : 503,
    );
  })
  .route("/api", jobsRouter)
  .route("/api", sourcesRouter)
  .route("/api", matchRouter)
  .route("/api", cvRouter)
  .route("/api", adminRouter)
  .route("/api", chatRouter)
  .route("/api", ingestRouter);

/** GLM reachability for /healthz. Cached for 60s; no tokens spent. */
let glmHealthCache: { at: number; value: "ok" | string } = {
  at: 0,
  value: "ok",
};
async function glmHealth(): Promise<string> {
  if (Date.now() - glmHealthCache.at < 60_000) return glmHealthCache.value;
  try {
    await glmPing();
    glmHealthCache = { at: Date.now(), value: "ok" };
  } catch (err) {
    glmHealthCache = { at: Date.now(), value: (err as Error).message };
  }
  return glmHealthCache.value;
}

export { config };
