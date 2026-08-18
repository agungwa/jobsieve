# Jobsieve

Remote/tech job aggregator with CV upload, deterministic parsing, semantic
matching, and a token-minimal AI chat. Live at <https://jobsieve.agung.click>.

- **Sources**: free public APIs (Arbeitnow, Remotive, RemoteOK) + per-company
  ATS boards (Greenhouse, Lever, Ashby). No LinkedIn/Indeed/Glassdoor scraping.
- **Zero-AI parsing**: CVs are parsed deterministically (regex contact
  extraction, heading-based section split, Aho-Corasick skill matching,
  date-range experience estimation). No LLM tokens.
- **Zero-AI matching**: jobs and CVs are embedded locally
  (`bge-small-en-v1.5`, 384 dims) and ranked with pgvector cosine distance.
- **The only LLM call site** is `POST /chat` (GLM via Z.ai). Admin key =
  unlimited; anonymous users get a daily rate limit + the cheap model +
  a prompt-hash response cache.

## Stack

Bun · TypeScript · Hono · Drizzle ORM · PostgreSQL + pgvector ·
@huggingface/transformers (local embeddings) · OpenAI SDK pointed at GLM

## Setup

Prerequisites: [Bun](https://bun.sh) 1.3+, PostgreSQL 16+ with the
[pgvector](https://github.com/pgvector/pgvector) extension.

```bash
bun install

# create the database (uses your local Postgres)
createdb jobsfound

# copy env and fill in values
cp .env.example .env
```

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres DSN (requires pgvector extension available) |
| `PORT` | `3000` | HTTP port |
| `GLM_API_KEY` | — | Z.ai API key (chat only) |
| `GLM_BASE_URL` | `https://api.z.ai/api/paas/v4` | OpenAI-compatible base URL |
| `GLM_MODEL_ADMIN` | `glm-4.6` | Chat model for admin requests |
| `GLM_MODEL_USER` | `glm-4.5-air` | Chat model for anon requests |
| `ADMIN_API_KEY` | — | Header `x-api-key` value for unlimited admin access |
| `RATE_LIMIT_PER_DAY` | `10` | Anon chat messages per 24h |
| `EMBEDDING_MODEL` | `bge-small-en-v1.5` | Local transformers.js model |
| `EMBEDDING_DIM` | `384` | Must match the model |
| `EMBEDDING_BATCH` | `64` | Worker batch size |
| `EMBEDDING_MAX_RETRIES` | `6` | Failed-embedding retry cap |
| `JOB_STALENESS_DAYS` | `30` | Jobs unseen this long are deleted |
| `CRON_ARBEITNOW` | `0 * * * *` | Simple-cron-ish schedules (see below) |
| `CRON_REMOTIVE` | `30 * * * *` | |
| `CRON_REMOTEOK` | `15 */4 * * *` | |
| `CRON_GREENHOUSE` | `0 */2 * * *` | |
| `CRON_LEVER` | `30 */2 * * *` | |
| `CRON_ASHBY` | `0 */3 * * *` | |
| `CRON_CLEANUP` | `17 3 * * *` | Daily stale-job cleanup |

> The in-process scheduler uses `setInterval` with a simplified cron parser
> (`* * * * *` = 1 min, `*/N * * * *` = N min, `M H * * *` = 24 h interval,
> otherwise hourly). It does not sync to wall clock.

### Migrate

```bash
bun run db:generate   # generate Drizzle migrations after schema edits
bun run db:migrate    # creates pgvector extension, runs migrations, adds HNSW indexes
```

### Run

```bash
bun run dev           # dev server with hot reload + scheduler (API on :3000)
bun run dev:web       # Vite dev server for the SPA (:5173, proxies /api → :3000)
bun run build:web     # production build into web/dist (served by the backend)
bun run ingest        # manual ingest from all sources
bun run ingest remotive greenhouse   # or pick sources
bun run typecheck
```

**Development**: run `bun run dev` and `bun run dev:web` side by side; open
http://localhost:5173 (hot reload, API proxied).

**Production**: `bun run build:web` then `bun run start` — the backend serves
the SPA at `/` and the API under `/api`. Deep links like `/jobs/<uuid>` fall
back to the SPA; `/api/*` 404s stay JSON.

### Web UI

- **User app** (`/`): job search with filters + cursor pagination, job
  details, CV upload (parsed without AI), match list with scores, AI chat.
- **Admin console** (`/admin`): enter your admin API key once — source
  health, job/embedding stats, chat token usage, ATS board management.

## API

All endpoints accept `x-api-key` (admin). Anonymous users are identified by
hashed IP.

### Jobs

```bash
# List with filters + keyset pagination
curl 'localhost:3000/api/jobs?limit=20&skill=react&remote=true&q=backend'
curl 'localhost:3000/api/jobs?cursor=2026-08-16T10:09:41Z|<uuid>'

# Single job (404 on unknown/invalid id)
curl 'localhost:3000/api/jobs/<uuid>'
```

### Sources

```bash
curl 'localhost:3000/api/sources'   # last run, status, error, pending count per source
```

### CV upload & profile

```bash
# Upload (PDF/DOCX/TXT, 10 MB cap; 415 unsupported, 413 oversize)
curl -X POST localhost:3000/api/cv -F 'file=@cv.pdf'

# Structured profile (no raw bytes/text)
curl "localhost:3000/api/cv/<uuid>"
```

Parsing is 100% deterministic — zero AI tokens. The row starts
`embedding_status: 'pending'` and the worker embeds it within a minute
(also triggered immediately after upload).

### Matching (zero LLM calls)

```bash
curl "localhost:3000/api/match?cv_id=<uuid>&limit=20"
curl "localhost:3000/api/match?cv_id=<uuid>&remote=true&skill=Go&salary_min=100000"
```

Ranks jobs by cosine similarity, excluding stale and non-embedded jobs.

### Chat (the only LLM call site)

```bash
curl -X POST localhost:3000/api/chat -H 'content-type: application/json' \
  -d '{"cv_id":"<uuid>","job_id":"<uuid>","message":"Am I a fit for this job?"}'

# admin (unlimited, glm-4.6)
curl -X POST localhost:3000/api/chat -H 'x-api-key: <ADMIN_API_KEY>' \
  -H 'content-type: application/json' -d '{"message":"Summarize the Go market"}'

# usage log
curl 'localhost:3000/api/chat/usage'
```

Identical prompts (system + message + referenced entity ids + their
`updated_at`) return the cached response — sub-50 ms, zero tokens.

### Admin

```bash
KEY='x-api-key: <ADMIN_API_KEY>'

# register an ATS board (idempotent on name+ats_type)
curl -X POST localhost:3000/api/admin/companies -H "$KEY" -H 'content-type: application/json' \
  -d '{"name":"Vercel","ats_type":"greenhouse","board_slug":"vercel"}'

# list boards with job counts
curl localhost:3000/api/admin/companies -H "$KEY"

# disable / hard-delete a board
curl -X DELETE localhost:3000/api/admin/companies/<id> -H "$KEY"
curl -X DELETE 'localhost:3000/api/admin/companies/<id>?hard=true' -H "$KEY"

# quick stats
curl localhost:3000/api/admin/stats -H "$KEY"
```

### Health

```bash
curl localhost:3000/healthz   # {status, db, glm} — 503 when degraded
```

## Token strategy

| Operation | AI tokens |
|---|---|
| CV parsing | 0 (deterministic) |
| Embeddings | 0 (local transformers.js, cached by content hash) |
| Job matching | 0 (pgvector cosine) |
| Chat | LLM, but: admin = personal use; anon = 10/day, flash model, cached |

## Security notes

- **No secrets in this repo.** All credentials live in environment variables
  (see `.env.example` — placeholders only). Local `.env` is gitignored.
- **Admin console** is unlinked from the nav, gated by `x-api-key`
  (timing-safe compare), and brute-force locked (10 wrong attempts per IP
  per hour → 429).
- **Visitor AI keys (BYOK)** are sent per request as a header, validated
  against an allowlist of endpoints/models, used for that one call, and
  never stored, cached, or logged. They live only in the visitor's browser
  (localStorage).
- **Uploaded CVs**: raw bytes are never written to the server's filesystem —
  parsed text goes to Postgres and is embedded from there.
- Chat inputs are rate-limited (Postgres-backed sliding window, works across
  serverless instances); BYOK calls bypass the limit since the caller pays
  their own provider costs.

## Known limitations

- **RemoteOK is best-effort.** It sits behind Cloudflare and intermittently
  returns 403 to non-browser agents. Fetches retry with exponential backoff
  (3 attempts); persistent failures are recorded in `sources.last_error` and
  the source is retried on its next schedule. Treat it as a bonus source, not
  a guaranteed one.
- **Remotive** requests ≤4 fetches/day (default schedule is hourly-but-light;
  raise `CRON_REMOTIVE` if you want to be extra polite) and requires
  attribution — job URLs point back to Remotive.
- Arbeitnow rate-limits to ~50 requests/window; default hourly schedule is safe.
- Lever verification: Notion's board no longer exists; Morning Brew
  (`morningbrew`) works as a sample board.
- The scheduler is interval-based, not wall-clock cron; restarts reset the
  in-memory rate-limit counters.
