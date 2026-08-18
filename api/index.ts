import { handle } from "hono/vercel";
import { app } from "../src/app";

/**
 * Vercel serverless entrypoint. All /api/* traffic (and /healthz) is
 * rewritten here by vercel.json; the SPA itself is served as static assets
 * from web/dist.
 */
export default handle(app);
