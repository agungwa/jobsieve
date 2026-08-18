## ADDED Requirements

### Requirement: Unified Job schema

The system SHALL persist every job in a single `jobs` table with at minimum: `id`, `source` (e.g. `arbeitnow`, `remotive`, `greenhouse`), `source_job_id`, `title`, `company`, `location`, `remote_allowed`, `salary_min`, `salary_max`, `salary_currency`, `salary_period`, `description`, `url`, `summary` (compressed), `skills` (array of normalized skill names), `posted_at`, `fetched_at`, `last_seen_at`, `content_hash`, `embedding_status` (`pending` | `embedded` | `failed`).

#### Scenario: Source provides only some fields

- **WHEN** a source returns a job with no salary information
- **THEN** the system SHALL store the job with `salary_min`, `salary_max`, `salary_currency`, `salary_period` all set to NULL rather than rejecting the job

#### Scenario: Field normalization

- **WHEN** a source returns a job with salary as a string like "$120k - $140k USD"
- **THEN** the system SHALL parse it into `salary_min=120000`, `salary_max=140000`, `salary_currency=USD`, `salary_period=yearly`

### Requirement: Source adapter interface

The system SHALL define a `SourceAdapter` interface that every source (API or ATS) implements. Each adapter SHALL expose: a unique `name`, a `fetch()` method returning an array of source-native job objects, and a `normalize(raw)` method returning the unified Job shape. Adapters MUST NOT write to the database directly.

#### Scenario: Adapter failure isolation

- **WHEN** the RemoteOK adapter throws on a Cloudflare 403
- **THEN** the ingest pipeline SHALL catch the error, log it, and continue invoking other adapters, never blocking sibling sources

### Requirement: Content-hash deduplication

The system SHALL compute a `content_hash` for each normalized job from the normalized form of `(company, title, location, skills)` (lowercased, whitespace-collapsed, HTML-stripped) and SHALL treat two jobs with the same `content_hash` as the same role regardless of source.

#### Scenario: Same role syndicated across sources

- **WHEN** a Stripe IC4 role appears on both Greenhouse and Remotive on the same day
- **THEN** the system SHALL store it once, with the earliest `posted_at` and the most recent `last_seen_at`, and record both sources in a `job_sources` join table

#### Scenario: Trivial description edit does not re-dedupe

- **WHEN** Greenhouse updates a job's description with cosmetic whitespace changes
- **THEN** the `content_hash` SHALL remain stable because it is computed from normalized text, not the raw description

### Requirement: Embedding-pending ingest

The system SHALL write every newly-ingested job with `embedding_status: 'pending'`. The ingest pipeline SHALL NOT call the embedding API inline.

#### Scenario: Ingest completes without embedding

- **WHEN** 50 new jobs are fetched from Arbeitnow
- **THEN** all 50 SHALL be persisted with `embedding_status: 'pending'` within one round-trip, regardless of embedding API availability

### Requirement: Background embedding worker

A separate worker (driven by `Bun.cron`) SHALL poll for jobs with `embedding_status: 'pending'`, batch them (up to N per call, default 64), call GLM `embedding-3` at 512 dimensions, store the vector, and flip status to `'embedded'`. On failure, the worker SHALL mark `'failed'` with a retry-count and `last_attempt_at` for exponential backoff.

#### Scenario: Batch embedding

- **WHEN** 200 pending jobs exist and the batch size is 64
- **THEN** the worker SHALL issue 4 embedding API calls in sequence, then mark all 200 as `'embedded'` if all calls succeed

#### Scenario: API failure retries

- **WHEN** an embedding API call returns 429
- **THEN** the worker SHALL mark the batch as `'failed'`, increment `retry_count`, and skip it until `last_attempt_at + 2^retry_count seconds` has elapsed

### Requirement: Per-source cron scheduling

The system SHALL register each source adapter on its own `Bun.cron` schedule (configurable per source, default 1-4 hours). Sources SHALL be pulled independently so one slow source does not delay another.

#### Scenario: Independent source schedules

- **WHEN** the Arbeitnow cron fires at 14:00 and the Greenhouse cron fires at 14:15
- **THEN** both runs SHALL execute independently; neither blocks the other even if Greenhouse pulls 100 company boards

### Requirement: Companies table for ATS discovery

The system SHALL maintain a `companies` table with `name`, `ats_type` (`greenhouse` | `lever` | `ashby`), `board_slug`, `enabled`, and timestamps. ATS adapters SHALL iterate `WHERE enabled = true AND ats_type = <adapter_type>`.

#### Scenario: Adding a new company board

- **WHEN** an admin POSTs `{ "name": "Vercel", "ats_type": "greenhouse", "board_slug": "vercel" }` to the admin endpoint
- **THEN** the system SHALL insert the row and the next Greenhouse cron tick SHALL include Vercel in its pull

### Requirement: Job expiry

The system SHALL track `last_seen_at` on every job and a daily cron SHALL soft-delete (or hard-delete, configurable) jobs whose `last_seen_at` is older than 30 days.

#### Scenario: Stale job cleanup

- **WHEN** a job was last seen 31 days ago and the cleanup cron runs
- **THEN** the job SHALL be removed from the active set so it no longer appears in search or match results
