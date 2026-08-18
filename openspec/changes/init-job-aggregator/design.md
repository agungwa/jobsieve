## Context

Greenfield project at `/Users/mymac/project/personal/jobs-found/`. No existing code. The user wants a single service that (a) pulls remote/tech jobs from free public APIs and per-company ATS endpoints, (b) lets users upload a CV and get matched to jobs, and (c) optionally chats with GLM about jobs. Hard constraint: minimize AI token spend — most "AI" features in similar products are actually deterministic work that does not need a model. The user has access to GLM (Z.ai / ZhipuAI) which exposes an OpenAI-compatible API at `https://open.bigmodel.cn/api/paas/v4/`.

## Goals / Non-Goals

**Goals:**
- Single Bun + TypeScript + Hono service deployable locally (dev) and to a single VPS (prod).
- Aggregate jobs from 3 free APIs + 3 ATS endpoint families into one unified schema.
- Persist jobs in Postgres with pgvector; dedupe identical roles syndicated across sources.
- Parse CVs into structured profiles using only deterministic (non-AI) techniques.
- Match CVs to jobs via cosine similarity — zero LLM calls per match.
- Reserve the LLM for user-initiated chat only, with admin bypass and per-user rate limits.
- Make token cost predictable and bounded: a CV upload or job match spends 0 chat tokens.

**Non-Goals:**
- No LinkedIn / Indeed / Glassdoor scraping (ToS + anti-bot, out of scope).
- No multi-tenant deployment, SaaS billing, or org-level isolation (single-instance for now).
- No web frontend in this change — API only. A frontend is a separate future change.
- No full-text search engine beyond Postgres (no Meilisearch / Elastic).
- No real-time streaming of new jobs via websockets (cron-driven polling is enough).
- No application-submission flow — we link out to the original posting URL.

## Decisions

### 1. Postgres-only with pgvector (no dual-dialect SQLite)

**Decision:** Commit to Postgres (with pgvector) for both dev and prod. Drop the SQLite dual-dialect idea.

**Why:** Drizzle's dual-dialect pattern requires maintaining two schema files that silently drift; vector storage has fundamentally different APIs (`sqlite-vec` brute-force KNN vs pgvector's HNSW/IVFFlat ANN index); and the moment the corpus crosses ~10k jobs at 512 dims, sqlite-vec sequential scans become unusable. Postgres dev in 2026 is one `docker compose up postgres` away, eliminating the entire class of "works in SQLite, breaks in Postgres" bugs.

**Alternatives considered:**
- *SQLite + sqlite-vec everywhere*: simpler ops, but no ANN index, brute-force scans, and you outgrow it.
- *SQLite for dev, Postgres for prod (dual schema)*: doubles schema maintenance, two vector implementations, drift risk.

### 2. Token-minimization strategy: parse without AI, embed once, match with cosine, LLM only for chat

**Decision:** Four-layer cost model.
1. CV parsing is entirely deterministic (`pdf-parse`/`unpdf` + `mammoth` + regex + skills dictionary). Zero tokens.
2. Each job and each CV is embedded exactly once via GLM `embedding-3` at 512 dimensions. Stored in pgvector.
3. Match queries are a single SQL `ORDER BY embedding <=> $1 LIMIT N`. Zero LLM calls.
4. LLM is invoked only on `/chat`, with admin bypass and per-user rate limit.

**Why:** The user explicitly asked "for parsing do we need AI? we need to minimize ai usage token strategy." This shape delivers the AI-flavored product (CV matching, chat) without the per-query token cost that bankrupts similar projects.

**Alternatives considered:**
- *LLM-based CV parsing* (one call per upload): simpler code, but ~2k tokens per CV, and re-parsing on edit doubles it.
- *Per-query LLM matching* ("rank these 50 jobs for me"): expensive at scale, slow, and quality is not better than good embeddings on short text.

### 3. GLM (Z.ai) as the AI provider, via OpenAI-compatible SDK

**Decision:** Use the `openai` npm package pointed at `https://open.bigmodel.cn/api/paas/v4/` for both chat and embeddings. Models: `glm-4.6` (admin), `glm-4-flash` (users), `embedding-3` (512 dims).

**Why:** GLM's API is wire-compatible with OpenAI. The user said "I want used my own glm for now." Using the OpenAI SDK avoids vendor lock-in at the code level and gives us typed client behavior for free.

**Alternatives considered:**
- *Native `zhipuai` SDK*: thinner but TypeScript-unfriendly and less mature.
- *Anthropic Claude*: excellent quality, but user explicitly chose GLM.

### 4. Embedding dimension = 512

**Decision:** Use `embedding-3` with `dimensions: 512` for both jobs and CVs.

**Why:** GLM `embedding-3` supports 256/512/1024/2048. At 2048 dims, 50k jobs is ~400 MB of float arrays; at 512 it is ~100 MB with negligible retrieval-quality loss on short text (job summaries are 20-50 words). Halves storage and computation.

**Alternatives considered:** 256 (faster but quality drops on subtle skill distinctions), 1024/2048 (overkill for this corpus size).

### 5. Decouple embedding from ingest via `embedding_status`

**Decision:** The ingest pipeline writes jobs with `embedding_status: 'pending'` and returns immediately. A separate cron-driven worker batches pending embeddings in chunks (e.g., 64 texts/call) and flips them to `'embedded'`.

**Why:** GLM API rate limits or downtime must never block job ingestion. This decoupling means a slow embedding API only delays search-index freshness — it never drops newly-fetched jobs.

**Alternatives considered:**
- *Synchronous embedding in ingest loop*: simpler, but a single API 429 blocks the whole source pull.
- *External queue (BullMQ + Redis)*: overkill; a status column + cron is sufficient at this scale.

### 6. Scheduler = `Bun.cron`, not a job queue

**Decision:** Use Bun's built-in cron for periodic source pulls and the embedding worker.

**Why:** The workload is periodic batch pulls (every 1-4 hours per source), not a high-throughput event-driven workload. Bun.cron runs in-process with no external state; restart-resilient by virtue of being re-registered on boot. Adding BullMQ would introduce Redis as a hard dependency for a project that otherwise needs zero external services beyond Postgres.

**Alternatives considered:**
- *BullMQ + Redis*: needed only if we need distributed workers, exponential backoff with state, or fan-out. Not yet.
- *System cron calling an endpoint*: works but loses type safety and couples deploy to host cron.

### 7. Compressed job summary stored at normalize time, used as chat context

**Decision:** Store a `summary` column on each job: `{title} · {company} · {skills} · {location} · {salary_range}`. Use this (not the raw description) when building LLM chat context.

**Why:** Sending 10 raw job descriptions into a chat is thousands of tokens. The summary carries the matching signal in ~30 tokens. This is a one-time normalize cost that permanently reduces every future chat token budget.

**Alternatives considered:**
- *LLM-generated summaries*: higher quality but recurring token cost, and they go stale when jobs change.
- *Truncated raw description*: simpler but 5-10x more tokens per chat.

### 8. Skills dictionary bootstrapped from Tanova's 139-skill tech taxonomy

**Decision:** Ship `data/skills.json` seeded from the Tanova open-source taxonomy (139 canonical skills with aliases). Grow it organically as missed matches appear in real CVs. Matcher uses Aho-Corasick (via the `aho-corasick` npm package) for efficient multi-pattern scan over CV text.

**Why:** A naive regex-per-skill loop is O(skills × text length) and slow at 500+ patterns. Aho-Corasick is O(text length + matches). Tanova is scoped to tech hiring which matches our domain.

**Alternatives considered:**
- *Lightcast Open Skills (35k skills)*: comprehensive but noisy outside tech, increases false positives.
- *Build from scratch*: months of tuning. Stand on Tanova's shoulders.

### 9. Admin identity = env-var API key check

**Decision:** `ADMIN_API_KEY` env var. Requests with `x-api-key: <matching value>` get admin privileges (unlimited GLM-4.6 chat). All other callers are treated as anonymous users subject to the rate limit (keyed by IP or a session header).

**Why:** The user explicitly said "for now I want I can used my own ai for my personal used." A hardcoded admin flag is the simplest path to that, with no auth-system build-out.

**Alternatives considered:**
- *Magic-link email auth*: needed before public launch, but out of scope for this change.
- *OAuth*: overkill for a single-admin instance.

## Risks / Trade-offs

- **[RemoteOK blocks cloud IPs]** → Treat RemoteOK as best-effort. Wrap in try/catch with exponential backoff; never let it block the rest of the ingest pipeline. Document it as a flaky source.
- **[`pdf-parse` may break under Bun]** → Day-one test; if it fails, fall back to `unpdf` (serverless-friendly wrapper around `pdfjs-dist`). Keep the text-extraction layer behind an interface so the fallback is one swap.
- **[GLM embedding API rate limits]** → Mitigated by Decision 5 (decoupled pending-status worker with batching).
- **[Cosine match quality lower than expected]** → Mitigate by embedding a composite text (`title + company + skills + location + seniority`) rather than the raw noisy description.
- **[No user identity for rate limiting]** → For now, rate-limit by IP. This is acceptable pre-launch; revisit when real users exist.
- **[Job data grows monotonically]** → Add a `last_seen_at` column and a daily cleanup of jobs not seen in 30 days.
- **[Salary formats differ wildly across sources]** → Add a deterministic salary normalizer producing `salary_min`, `salary_max`, `salary_currency`, `salary_period`. No AI needed.
- **[ATS board discovery is manual]** → Ship a `companies` table (`ats_type`, `board_slug`) with an admin-only endpoint to add entries. This is how coverage grows beyond the three free APIs.
