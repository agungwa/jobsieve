#!/usr/bin/env bash
# Assembles .vercel/output (Build Output API v3) directly and deploys with
# `vercel deploy --prebuilt`. We bypass `vercel build`'s function builder:
# its per-file ESM transpile cannot resolve cross-directory imports, and it
# overflows its stack on our bundled function.
#
# Usage: bash scripts/build-vercel-output.sh
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=.vercel/output
rm -rf "$OUT"
mkdir -p "$OUT/static" "$OUT/functions/api/index.func"

# Root deps are needed to bundle the API (esbuild resolves hono/drizzle/
# postgres/openai from root node_modules). Fresh checkouts (CI) have none.
bun install --frozen-lockfile

# ── Static SPA ──────────────────────────────────────────────────────────────
(cd web && bun install --frozen-lockfile && bun run build)
cp -R web/dist/. "$OUT/static/"

# ── Serverless function (single self-contained ESM bundle) ─────────────────
bunx esbuild scripts/vercel-entry.ts \
  --bundle --platform=node --format=esm \
  --outfile="$OUT/functions/api/index.func/index.mjs"

cat > "$OUT/functions/api/index.func/.vc-config.json" <<'JSON'
{
  "runtime": "nodejs22.x",
  "handler": "index.mjs",
  "memory": 1024,
  "maxDuration": 60
}
JSON

# ── Routing + cron (mirrors vercel.json; prebuilt deploys read config.json) ─
cat > "$OUT/config.json" <<'JSON'
{
  "version": 3,
  "routes": [
    { "handle": "filesystem" },
    { "src": "^/api(?:/(.*))$", "dest": "/api/index", "check": true },
    { "src": "^/healthz$", "dest": "/api/index", "check": true },
    { "src": "^/(.*)$", "dest": "/index.html" }
  ],
  "crons": [
    { "path": "/api/ingest", "schedule": "30 2 * * *" }
  ]
}
JSON

echo "✓ Build output assembled at $OUT"
