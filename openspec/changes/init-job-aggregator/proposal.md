## Why

Remote/tech job seekers have no single place to see listings across the free, fragmented job APIs (Arbeitnow, Remotive, RemoteOK) plus individual company career pages (Greenhouse, Lever, Ashby ATS boards). Existing aggregators are either paywalled, ad-heavy, or limited to one source. There is also no easy way for a job seeker to upload a CV and get matched to roles without paying for AI-credits, because most matchers use an LLM call per query — expensive and slow. This project solves both by aggregating free sources into one searchable feed and matching CVs to jobs via cosine similarity on one-shot embeddings, reserving the LLM only for user-initiated chat.

## What Changes

- New Bun + TypeScript + Hono service `jobs-found` with Postgres-only persistence via Drizzle ORM and pgvector.
- Multi-source ingestion: Arbeitnow, Remotive, RemoteOK (free public APIs), plus Greenhouse / Lever / Ashby per-company ATS board endpoints.
- Unified `Job` model + content-hash dedupe so the same role syndicated across sources is stored once.
- `Bun.cron`-driven scheduler pulls each source on its own interval; embedding is decoupled from ingest (jobs land with `embedding_status: 'pending'`, a background worker embeds them in batches).
- CV upload endpoint that parses PDF/DOCX **without AI** (`pdf-parse` / `unpdf` fallback + `mammoth`) into a structured `CVProfile` via regex contact extraction, heading-based section detection, and a skills-dictionary matcher (bootstrapped from the Tanova 139-skill tech taxonomy).
- One-shot embedding of CVs and jobs with GLM `embedding-3` at 512 dimensions (cost/storage sweet spot), stored in pgvector.
- `/match` endpoint returns top-N jobs for the authenticated CV using pgvector cosine `<=>` query — **no LLM call**.
- `/chat` endpoint with two tiers: admin (env-flagged, unlimited GLM-4.6) and regular users (rate-limited GLM-4-flash). Responses are cached by prompt hash to minimize token spend.
- Compressed job summaries (title + company + skills + location + salary) stored at normalize time and used as chat context instead of raw descriptions, permanently reducing every future chat's token budget.

## Capabilities

### New Capabilities
- `job-ingestion`: Pull jobs from external sources (Arbeitnow, Remotive, RemoteOK, Greenhouse, Lever, Ashby), normalize to a unified schema, dedupe by content hash, and persist with embedding-pending status.
- `cv-profile`: Accept PDF/DOCX/TXT CV uploads, extract text without AI, and produce a structured profile (contacts, sections, skills, years of experience) via regex and dictionary matching.
- `semantic-matching`: One-shot embedding of jobs and CVs (GLM embedding-3, 512 dims) with cosine similarity search via pgvector, decoupled from ingest via a pending-embedding worker.
- `ai-chat`: GLM-powered chat about jobs with admin-bypass unlimited access (GLM-4.6) and rate-limited user access (GLM-4-flash), using compressed job summaries as context and caching responses by prompt hash.
- `job-search-api`: HTTP API exposing job listings, search, CV upload, match, and chat endpoints.

### Modified Capabilities
<!-- None — this is a greenfield project. -->

## Impact

- **Code**: New project in `/Users/mymac/project/personal/jobs-found/` — no existing code to migrate.
- **Dependencies**: `bun`, `hono`, `drizzle-orm`, `drizzle-kit`, `postgres` (or `bun:sql`), `pgvector` extension, `pdf-parse`/`unpdf`, `mammoth`, GLM SDK or `openai`-compatible HTTP client pointed at `https://open.bigmodel.cn/api/paas/v4/`.
- **External services**: Z.ai / ZhipuAI GLM API (user-supplied key), Postgres ≥ 14 with pgvector extension.
- **Risks**: RemoteOK sits behind Cloudflare and may block cloud IPs (treat as best-effort); `pdf-parse` may need `unpdf` fallback under Bun; GLM embedding API rate limits could delay search-index freshness (mitigated by decoupling embedding from ingest).
