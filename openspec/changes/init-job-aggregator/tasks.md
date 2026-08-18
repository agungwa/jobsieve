## 1. Project foundation

- [x] 1.1 Initialize Bun project: `bun init`, configure `tsconfig.json` (strict, moduleTypes), set up `package.json` scripts (`dev`, `start`, `db:migrate`, `db:generate`, `ingest`)
- [x] 1.2 Install core deps: `hono`, `drizzle-orm`, `drizzle-kit`, `postgres`, `pgvector` types, `zod` for validation, `openai` (for GLM client), `pdf-parse`, `unpdf`, `mammoth`, `aho-corasick`
- [x] 1.3 Set up `src/config.ts` reading env vars: `DATABASE_URL`, `GLM_API_KEY`, `GLM_BASE_URL=https://open.bigmodel.cn/api/paas/v4/`, `ADMIN_API_KEY`, `EMBEDDING_DIM=512`, `EMBEDDING_BATCH=64`, source-specific cron intervals
- [x] 1.4 Create `.env.example` documenting every variable
- [x] 1.5 Create `docker-compose.yml` with a Postgres 16 + pgvector service for local dev

## 2. Database schema & migrations

- [x] 2.1 Write `src/db/schema.ts` (single Postgres schema) with tables: `jobs`, `job_sources`, `job_skills`, `companies`, `cv_profiles`, `cv_skills`, `embedding_cache`, `chat_usage`, `chat_cache`. Use `customType` for `vector(512)` columns
- [x] 2.2 Add `pgvector` extension migration (`CREATE EXTENSION IF NOT EXISTS vector`)
- [x] 2.3 Add HNSW indexes on `jobs.embedding` and `cv_profiles.embedding` for cosine distance (`vector_cosine_ops`)
- [x] 2.4 Configure `drizzle.config.ts` and generate the first migration with `bun db:generate`
- [x] 2.5 Create `src/db/client.ts` exporting a singleton Drizzle instance, with connection-retry on startup (per the Stack Overflow pattern)
- [x] 2.6 Verify migration applies cleanly on a fresh Postgres container

## 3. Unified domain types & errors

- [x] 3.1 Create `src/types/job.ts` with `NormalizedJob`, `SourceJob`, `Job` types matching the spec
- [x] 3.2 Create `src/types/cv.ts` with `CVProfile`, `ParsedCV`, `Contact`, `Section`, `SkillMatch`
- [x] 3.3 Create `src/errors.ts` with typed error classes: `SourceUnavailableError`, `RateLimitError`, `EmbeddingFailedError`, `ParseError`, each exposing `code` and `retryable` flags

## 4. Source adapter: Arbeitnow (end-to-end vertical slice)

- [x] 4.1 Define `src/sources/types.ts` with the `SourceAdapter` interface (`name`, `fetch()`, `normalize(raw)`)
- [x] 4.2 Implement `src/sources/arbeitnow.ts` calling `https://www.arbeitnow.com/api/job-board-api/jobs` (no auth)
- [x] 4.3 Write the `src/ingest/normalize.ts` pure function: source-native → `NormalizedJob`. Cover salary string parsing (`$120k - $140k USD` → min/max/currency/period), location normalization, HTML-stripping of description
- [x] 4.4 Write `src/ingest/dedupe.ts`: compute `content_hash` from normalized `(company, title, location, skills)` (SHA-256 hex), upsert on conflict, update `last_seen_at` and merge into `job_sources`
- [x] 4.5 Write `src/ingest/pipeline.ts` orchestrating fetch → normalize → dedupe → persist with `embedding_status: 'pending'`. Wrap each adapter call in try/catch for failure isolation
- [x] 4.6 Add a `bun ingest` script that runs the Arbeitnow pipeline on demand (manual test before cron)

## 5. HTTP API: minimal vertical slice

- [x] 5.1 Create `src/index.ts` bootstrapping Hono, attaching routes, and starting `Bun.serve`
- [x] 5.2 Create `src/middleware/error.ts` returning the uniform JSON error envelope from the spec
- [x] 5.3 Create `src/middleware/admin.ts` checking `x-api-key` against `ADMIN_API_KEY` and setting `ctx.set('role', 'admin' | 'anon')`
- [x] 5.4 Implement `GET /jobs` with keyset pagination (`limit`, `cursor`), default limit 20, max 100, excluding stale and non-embedded jobs
- [x] 5.5 Implement filter query params: `source`, `company`, `remote`, `skill` (repeatable, AND), `salary_min`, `location`, `q` (ILIKE title+company+summary)
- [x] 5.6 Implement `GET /jobs/:id` (full record) and `404 job_not_found` path
- [x] 5.7 Implement `GET /sources` (last_run_at, last_status, last_error, jobs_fetched, embedding_pending_count)

## 6. Scheduler (Bun.cron) and background workers

- [x] 6.1 Create `src/scheduler/cron.ts` registering per-source crons (Arbeitnow hourly, others configurable)
- [x] 6.2 Create `src/scheduler/embedding-worker.ts` polling `embedding_status: 'pending'`, batching up to 64, calling GLM `embedding-3` with `dimensions: 512`
- [x] 6.3 Implement the `embedding_cache` lookup (SHA-256 of normalized composite text) so identical texts skip the API
- [x] 6.4 Implement retry with exponential backoff on `RateLimitError`/`EmbeddingFailedError` (status `failed`, increment `retry_count`, skip until `last_attempt_at + 2^retry_count`)
- [x] 6.5 Register the embedding worker on a 1-minute cron
- [x] 6.6 Register a daily cleanup cron that removes jobs with `last_seen_at` older than 30 days (configurable)

## 7. Additional source adapters

- [x] 7.1 Implement `src/sources/remotive.ts` (`https://remotive.com/api/remote-jobs`)
- [x] 7.2 Implement `src/sources/remoteok.ts` (`https://remoteok.com/api`) wrapped in try/catch with exponential backoff (Cloudflare risk); log to `sources.last_error`
- [x] 7.3 Implement `src/sources/ats/greenhouse.ts` iterating `companies WHERE ats_type='greenhouse' AND enabled=true` against `https://boards-api.greenhouse.io/v1/boards/{board}/jobs`
- [x] 7.4 Implement `src/sources/ats/lever.ts` against `https://api.lever.co/v0/postings/{company}`
- [x] 7.5 Implement `src/sources/ats/ashby.ts` against `https://api.ashbyhq.com/posting-api/job-board/{board}`
- [x] 7.6 Implement `POST /admin/companies` (admin-only) to insert new ATS boards; verify with Vercel (Greenhouse), Notion (Lever), Ashby demo board
  - Note: Notion's Lever board is gone (`Document not found`); verified with Morning Brew (`morningbrew`) instead
- [x] 7.7 Register each new adapter on its own cron in `src/scheduler/cron.ts`

## 8. CV upload and deterministic parsing

- [x] 8.1 Create `src/cv/extract.ts` with a `TextExtractor` interface; implement `pdf-parse` first, `unpdf` as automatic fallback on parse error, `mammoth` for DOCX, raw read for TXT
- [x] 8.2 Day-one test of `pdf-parse` under Bun; if it throws "no module parent," confirm `unpdf` fallback works and document
- [x] 8.3 Implement `src/cv/contact.ts` regex extractors: email, phone (E.164-tolerant), GitHub URL, LinkedIn URL, personal URL
- [x] 8.4 Implement `src/cv/sections.ts` heading-detection splitter with a known-headings dictionary (case-insensitive, colon-suffix tolerant, all-caps tolerant)
- [x] 8.5 Bootstrap `data/skills.json` from the Tanova 139-skill taxonomy (canonical names + aliases)
- [x] 8.6 Implement `src/cv/skills.ts` using the `aho-corasick` npm package to scan CV text in one pass; map every alias hit to its canonical name; count occurrences per skill
- [x] 8.7 Implement `src/cv/experience.ts` date-range scanner over the experience section, summing spans into `estimated_years_experience`
- [x] 8.8 Implement `POST /cv` (multipart, 10 MB cap, PDF/DOCX/TXT only, `415` on unsupported type, `413` on oversize)
- [x] 8.9 Implement `GET /cv/:id` returning the structured profile (no raw bytes/raw_text)
- [x] 8.10 Verify end-to-end: upload a 3-page PDF CV, confirm zero LLM tokens spent, profile row has `embedding_status: 'pending'`

## 9. Semantic matching

- [x] 9.1 Implement `src/vector/glm-embed.ts` OpenAI-compatible embedding client at `${GLM_BASE_URL}/embeddings` with model `embedding-3`, `dimensions: 512`
- [x] 9.2 Implement composite text builders: `buildJobComposite(job)` and `buildCvComposite(profile)` per the spec (short, signal-rich strings)
- [x] 9.3 Wire the embedding worker to embed CVs (not just jobs) when `cv_profiles.embedding_status = 'pending'`
- [x] 9.4 Implement `GET /match?cv_id=<id>&limit=N` using pgvector `ORDER BY embedding <=> $cv_embedding LIMIT N`, with SQL filters (`remote`, `skill`, `salary_min`)
- [x] 9.5 Verify `/match` returns in under 200 ms p95 against a 10k-job seeded corpus, with zero LLM calls
- [x] 9.6 Confirm stale and non-embedded jobs are excluded from results

## 10. AI chat (the only LLM call site)

- [x] 10.1 Implement `src/ai/glm.ts` OpenAI-compatible chat client at `${GLM_BASE_URL}/chat/completions` with model selection: `glm-4.6` (admin) / `glm-4-flash` (anon)
- [x] 10.2 Implement `src/middleware/rate-limit.ts` sliding-window per-IP limit (default 10/day), `429` with `Retry-After` on exceedance
- [x] 10.3 Implement `POST /chat` accepting `{ cv_id?, job_id?, message }`, building context from `summary` (jobs) and top skills / years / target role (CVs)
- [x] 10.4 Implement prompt-hash cache in `chat_cache` (hash includes system prompt + message + referenced job/cv ids + their `updated_at`); invalidate on referenced entity update
- [x] 10.5 Log every GLM call to `chat_usage` (user_key, model, prompt_tokens, completion_tokens, cached, latency_ms, created_at)
- [x] 10.6 Verify admin bypass sends 100 requests without throttling; verify anon at 11th request gets `429`; verify repeat question hits cache (sub-50 ms, zero tokens)
  - Note: verified with 12 requests (admin bypass ✓, anon 429 at 11th ✓, cache hit 37ms/0 tokens ✓ via seeded row). Live GLM completion pending — account has no balance (error 1113)

## 11. Observability & docs

- [x] 11.1 Add structured logging (Bun's built-in logger or `pino`-equivalent) keyed by request id
- [x] 11.2 Add a `/healthz` endpoint (DB ping, GLM ping) for uptime monitoring
- [x] 11.3 Write `README.md` with: setup, env vars, `docker compose up`, migration commands, manual ingest, sample curl calls for every endpoint
- [x] 11.4 Document known flakiness: RemoteOK behind Cloudflare (best-effort only)
