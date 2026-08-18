cl# Deploying Jobsieve to Vercel (free tier)

Architecture on Vercel:

```
web/dist (static SPA)      ← @vercel/static-build from web/package.json
api/index.ts               ← single serverless function (Hono via hono/vercel)
Neon Postgres (pooled)     ← all data + pgvector
Cloudflare Workers AI      ← embeddings (same bge-small-en-v1.5, 384-dim)
Vercel Cron (daily 02:30)  ← POST /api/ingest (bearer CRON_SECRET)
```

## 1. Neon (Postgres + pgvector)

1. Create a project; note the **pooled** connection string (host contains
   `-pooler`). The app auto-disables prepared statements for pooled hosts.
2. Run migrations against Neon:
   ```sh
   DATABASE_URL="postgres://...-pooler..." bun run db:migrate
   ```
3. Optional: seed by running one full ingest locally against Neon:
   ```sh
   DATABASE_URL="postgres://...-pooler..." bun run ingest
   ```

## 2. Cloudflare Workers AI (embeddings)

1. Cloudflare dashboard → Workers AI → create an API token
   (permission: Workers AI read). Copy the Account ID from the overview page.
2. These become `CF_ACCOUNT_ID` and `CF_API_TOKEN`.
3. Vectors are identical to the local transformers.js pipeline (same model,
   same dim) — no re-embedding needed when switching.

## 3. Vercel

1. Import the repo, framework preset: **Other**.
2. Environment variables (Production):
   - `DATABASE_URL` — Neon **pooled** string
   - `ADMIN_API_KEY`
   - `EMBEDDING_PROVIDER=cloudflare`
   - `CF_ACCOUNT_ID`, `CF_API_TOKEN`
   - `CRON_SECRET` — random string (Vercel sends it as a Bearer token on
     every cron invocation)
   - `NODE_ENV=production`
   - Optional — `GLM_API_KEY`, `GLM_BASE_URL`, `GLM_MODEL_ADMIN`,
     `GLM_MODEL_USER`: without `GLM_API_KEY` the app runs fine and chat
     requires visitors to add their own key in the browser (BYOK, zero
     cost for you). Set it only if you want a shared key for anonymous
     users. Base URL default is the Coding Plan endpoint
     (`https://api.z.ai/api/anthropic`).
3. Deploy. `vercel.json` handles the rest: static build, `/api/*` rewrite to
   the function, SPA fallback, 60s function duration, daily cron.

## 4. Custom domain — jobsieve.agung.click

1. Vercel dashboard → your project → **Settings → Domains** → add
   `jobsieve.agung.click`.
2. In your DNS provider for `agung.click`, add a record:
   - Type **CNAME**, name `jobsieve`, value `cname.vercel-dns.com`.
   - (If your DNS host rejects a CNAME at the subdomain level, use an
     A record: `76.76.21.21` — but the CNAME is preferred.)
3. Wait for DNS propagation (minutes to a few hours). Vercel issues the
   HTTPS certificate automatically.
4. Verify: `curl -I https://jobsieve.agung.click/healthz` → `200`, and
   `https://jobsieve.agung.click/sitemap.xml` + `/robots.txt` serve from
   `web/public/`.
5. SEO is pre-wired for this domain: canonical URL, Open Graph/Twitter
   cards, JSON-LD `WebSite` + `SearchAction`, `sitemap.xml`, `robots.txt`
   (all reference `https://jobsieve.agung.click`). If you ever change the
   domain, update: `web/index.html` (canonical + OG/Twitter + JSON-LD),
   `web/public/robots.txt`, `web/public/sitemap.xml`.

## CI/CD (GitHub Actions → Vercel)

`.github/workflows/deploy.yml` automates the whole pipeline:

| Event | What runs |
|---|---|
| Pull request → master | **check** job only (typecheck backend + build web) |
| Push to master | check → **migrate** (drizzle migrations against `DATABASE_URL`) → **deploy** (Vercel production) |
| Manual (Actions tab) | same as push |

### One-time setup

1. Link the project once locally (creates `.vercel/` with org/project IDs —
   do NOT commit it):
   ```sh
   npm i -g vercel && vercel link
   ```
2. Create a token: <https://vercel.com/account/tokens> → Add Token.
3. In GitHub → repo → **Settings → Secrets and variables → Actions** add:
   - `VERCEL_TOKEN` — the token from step 2
   - `VERCEL_ORG_ID` — from `.vercel/project.json` (`orgId`)
   - `VERCEL_PROJECT_ID` — from `.vercel/project.json` (`projectId`)
   - `DATABASE_URL` — Neon **pooled** connection string (for migrations)
4. Push to master — done. Every push now deploys automatically.

Runtime env vars (`GLM_API_KEY`, `ADMIN_API_KEY`, `CRON_SECRET`,
`CF_ACCOUNT_ID`, `CF_API_TOKEN`, …) are set once in the Vercel dashboard
(Settings → Environment Variables) — the workflow does not manage them.

## Free-tier limitation handling

| Limit | Mechanism |
|---|---|
| Function 60s max duration | `/api/ingest` works to a time budget (`INGEST_TIME_BUDGET_MS`, default 50s) and re-invokes itself via `VERCEL_URL` until the embedding queue drains |
| 4.5MB request body | CV upload capped at 4MB (`CV_MAX_BYTES`), enforced server + client |
| Ephemeral filesystem | CV raw bytes no longer written to disk; parsed text lives in Postgres |
| No background workers | CV embedding runs inline on upload; job embedding runs in the cron loop; failed rows retry on the next cron (`EMBEDDING_MAX_RETRIES`) |
| Per-instance memory | Rate limiter is Postgres-backed (`rate_limit_hits`), so limits hold across concurrent function instances |
| Workers AI 429/5xx | Exponential backoff (4 attempts, honors retry-after); vectors L2-normalized client-side |
| Neon connection cap | Pooled endpoint + `prepare:false` + aggressive idle recycling (see src/db/client.ts) |
| Cron = 1×/day on Hobby | Acceptable for job boards; trigger manually with `curl -X POST https://<app>/api/ingest -H "x-api-key: <ADMIN_API_KEY>"` |

## Local development

Unchanged: `bun run dev` (API + SPA on :3000, transformers.js local
embeddings). `EMBEDDING_PROVIDER=cloudflare` also works locally.
