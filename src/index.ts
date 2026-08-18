import { serveStatic } from "hono/bun";
import path from "node:path";
import { config } from "./config";
import { app } from "./app";

// Relative to process cwd (repo root when run via `bun run dev`).
const WEB_DIST_ROOT = "web/dist";

// Production: serve the built SPA from web/dist. Skipped when the build
// doesn't exist (dev uses the Vite server instead).
app
  .use("*", serveStatic({ root: WEB_DIST_ROOT }))
  .get("*", async (c) => {
    // SPA fallback for client-side routes; never shadow /api or healthz.
    const p = c.req.path;
    if (p.startsWith("/api") || p === "/healthz") return c.notFound();
    const index = path.join(WEB_DIST_ROOT, "index.html");
    if (!(await Bun.file(index).exists())) return c.notFound();
    return c.html(await Bun.file(index).text());
  });

const server = Bun.serve({
  port: config.PORT,
  fetch: app.fetch,
});

console.info(`[jobs-found] listening on http://localhost:${server.port}`);

// Scheduler is lazy-imported so the server boots without it (not used on
// Vercel — cron there hits /api/ingest instead).
if (config.NODE_ENV !== "test") {
  import("./scheduler/cron")
    .then((mod) => mod.startScheduler())
    .catch((err) => console.error("[scheduler] failed to start:", err));
}
