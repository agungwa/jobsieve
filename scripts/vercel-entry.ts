import { app } from "../src/app";

/**
 * Vercel serverless entrypoint SOURCE.
 *
 * Never deployed as-is: scripts/build-vercel-output.sh runs esbuild over
 * this into a single self-contained api function. Named fetch-style
 * exports are required — a default export gets invoked with the legacy
 * (req, res) Node signature, which Hono cannot process.
 */
const handler = (request: Request) => app.fetch(request);

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;
export const HEAD = handler;
export const OPTIONS = handler;
