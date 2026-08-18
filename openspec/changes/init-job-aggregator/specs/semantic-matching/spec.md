## ADDED Requirements

### Requirement: pgvector storage

The system SHALL store job and CV embeddings in `vector(512)` columns on the `jobs` and `cv_profiles` tables respectively, using the pgvector extension. The system SHALL NOT store vectors as JSON/TEXT — only native vector columns.

#### Scenario: Vector column exists

- **WHEN** the schema is migrated on a fresh Postgres instance
- **THEN** the `jobs.embedding` and `cv_profiles.embedding` columns SHALL be of type `vector(512)` and an HNSW index SHALL exist on each

### Requirement: GLM embedding-3 at 512 dimensions

The system SHALL call GLM `embedding-3` with `dimensions: 512` for all embedding work. The system SHALL NOT mix dimensions — every embedding (jobs and CVs) SHALL use 512.

#### Scenario: Consistent dimension

- **WHEN** a job is embedded on Monday and a CV is embedded on Tuesday
- **THEN** both stored vectors SHALL be 512-dimensional and directly comparable via cosine similarity

### Requirement: Composite text embedding

The system SHALL embed a composite summary string rather than the raw job description or full CV text. For jobs: `"{title} · {company} · {skills joined} · {location} · {seniority}"`. For CVs: `"{target_role} · {top_skills joined} · {years} years · {seniority}"`.

#### Scenario: Job embeds short composite

- **WHEN** a Senior Backend Engineer job at Stripe is embedded
- **THEN** the embedded text SHALL be on the order of 20-50 words (e.g. `"Senior Backend Engineer · Stripe · Go, Kubernetes, PostgreSQL · Remote (US) · Senior"`), not the full 2-paragraph description

### Requirement: Cosine similarity match endpoint

The system SHALL expose `GET /match?cv_id=<id>&limit=N` (default N=20) that returns the top-N jobs ranked by cosine similarity (`embedding <=> cv_embedding`) using pgvector's ANN index. The query SHALL NOT call any LLM.

#### Scenario: Match returns ranked results

- **WHEN** a CV with `embedding_status: 'embedded'` is matched against a corpus of 10,000 embedded jobs with `limit=10`
- **THEN** the system SHALL return 10 jobs ordered by ascending cosine distance, each with a `score` field (1 - distance), in under 200 ms p95, having made zero LLM calls

#### Scenario: Filter on top of match

- **WHEN** the request is `GET /match?cv_id=X&limit=10&remote=true&skill=Go`
- **THEN** the system SHALL apply the filters as SQL `WHERE` clauses before the vector ordering, returning only jobs that satisfy them

### Requirement: Match excludes stale jobs

The system SHALL exclude jobs with `last_seen_at` older than the configurable staleness window (default 30 days) from match results.

#### Scenario: Stale job hidden

- **WHEN** a job was last seen 45 days ago
- **THEN** it SHALL NOT appear in `/match` results regardless of cosine score

### Requirement: Embedding failure does not corrupt match

The system SHALL exclude jobs with `embedding_status != 'embedded'` or with a NULL embedding from match results.

#### Scenario: Pending job excluded

- **WHEN** a job is freshly ingested and still `embedding_status: 'pending'`
- **THEN** it SHALL NOT appear in `/match` results until its embedding is stored

### Requirement: Batch embedding with content-hash cache

The embedding worker SHALL hash each composite text (SHA-256, normalized) and check an `embedding_cache` table before calling the API. If the hash exists, the cached vector SHALL be reused. Otherwise the worker SHALL batch up to 64 uncached texts per API call, store the results, and record the cache entries.

#### Scenario: Identical text hits cache

- **WHEN** two jobs at different companies share an identical composite string (very rare, but possible for boilerplate postings)
- **THEN** the second one SHALL reuse the cached vector with zero embedding API calls

#### Scenario: Batch within API limit

- **WHEN** 150 pending jobs have unique composite strings
- **THEN** the worker SHALL issue 3 API calls (64 + 64 + 22) and persist 150 vectors
