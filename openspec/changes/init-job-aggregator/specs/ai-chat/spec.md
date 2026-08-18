## ADDED Requirements

### Requirement: GLM chat endpoint

The system SHALL expose `POST /chat` accepting `{ "cv_id"?: string, "job_id"?: string, "message": string }` and returning the GLM-generated response as a streamed (SSE) or non-streamed JSON body. The system SHALL call GLM via the OpenAI-compatible SDK pointed at `https://open.bigmodel.cn/api/paas/v4/`.

#### Scenario: Job-specific chat

- **WHEN** the request is `{ "job_id": "abc", "message": "What's the tech stack?" }`
- **THEN** the system SHALL load the job's `summary` (compressed form, not raw description), include it in the system prompt, and call GLM once

#### Scenario: CV-aware chat

- **WHEN** the request includes `cv_id`
- **THEN** the system SHALL include the CV's `top_skills`, `years_experience`, and `target_role` in the system prompt so the assistant can tailor its answer

### Requirement: Admin bypass via env-var API key

The system SHALL treat any request with header `x-api-key` matching the `ADMIN_API_KEY` env var as an admin request. Admin requests SHALL use model `glm-4.6` and SHALL NOT be subject to the rate limit.

#### Scenario: Admin unlimited

- **WHEN** an admin sends 100 chat requests in a minute
- **THEN** all 100 SHALL be forwarded to GLM-4.6 with no rate-limit error

#### Scenario: Non-admin keyed as anonymous

- **WHEN** a request arrives with no `x-api-key` header or a non-matching value
- **THEN** the system SHALL treat it as an anonymous user request subject to the rate limit

### Requirement: Per-IP rate limit for non-admin users

The system SHALL apply a sliding-window rate limit to non-admin requests (default: 10 requests/day per IP, configurable). On limit exceedance the system SHALL respond `429 Too Many Requests` with a `Retry-After` header.

#### Scenario: Daily limit enforced

- **WHEN** an anonymous IP sends its 11th request of the day with a default limit of 10
- **THEN** the system SHALL respond `429`, include `Retry-After` set to seconds-until-midnight, and not call GLM

#### Scenario: Limit resets

- **WHEN** the sliding window rolls past the configured period
- **THEN** the IP's counter SHALL reset and subsequent requests SHALL succeed

### Requirement: GLM-4-flash for non-admin users

The system SHALL route non-admin chat requests to model `glm-4-flash` to minimize per-user token cost. Admin requests SHALL route to `glm-4.6`.

#### Scenario: Anonymous uses flash

- **WHEN** an anonymous user sends a chat request
- **THEN** the forwarded GLM call SHALL use `model: "glm-4-flash"`

### Requirement: Compressed job summary as chat context

When the chat references a `job_id`, the system SHALL inject the job's `summary` column (not the raw description) into the LLM context. The system SHALL cap total context at the top 5 most-relevant job summaries if the user asks about multiple jobs.

#### Scenario: Summary used, not raw description

- **WHEN** a user asks "Tell me about this job" with a `job_id`
- **THEN** the LLM context SHALL contain ~30-50 tokens of job metadata (the summary), not the 500+ token raw description

### Requirement: Response cache by prompt hash

The system SHALL hash the normalized prompt (system prompt + user message + referenced job/cv ids and their `updated_at` timestamps) and check a `chat_cache` table. On a hit, the system SHALL return the cached response without calling GLM. The cache SHALL be invalidated automatically when the referenced job or CV is updated.

#### Scenario: Repeat question hits cache

- **WHEN** the same user (or another user) asks the identical question about the same job within the cache TTL
- **THEN** the system SHALL return the cached response in under 50 ms with zero GLM tokens spent

#### Scenario: Job update invalidates cache

- **WHEN** a job's `summary` is updated because skills were re-normalized
- **THEN** all `chat_cache` entries referencing that job SHALL be invalidated, because the hash includes the job's `updated_at`

### Requirement: Token usage logging

The system SHALL log every GLM call to a `chat_usage` table: `user_key` (admin marker or hashed IP), `model`, `prompt_tokens`, `completion_tokens`, `cached` (bool), `latency_ms`, `created_at`. This drives observability and cost estimation.

#### Scenario: Admin and user traffic distinguishable

- **WHEN** an admin and an anonymous user both send a chat request
- **THEN** the `chat_usage` rows SHALL be distinguishable (e.g. `user_key = 'admin'` vs `'ip:<hash>'`), enabling per-tier cost reporting
