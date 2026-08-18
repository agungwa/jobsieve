## ADDED Requirements

### Requirement: Job listing endpoint

The system SHALL expose `GET /jobs` returning a paginated list of jobs, newest first by default. The endpoint SHALL accept `limit` (default 20, max 100) and `cursor` for keyset pagination, and SHALL exclude stale and non-embedded jobs.

#### Scenario: Default first page

- **WHEN** a client calls `GET /jobs` with no params
- **THEN** the system SHALL return up to 20 jobs ordered by `posted_at DESC`, each with a `cursor` field for the next page

#### Scenario: Pagination

- **WHEN** a client calls `GET /jobs?cursor=<token>&limit=50`
- **THEN** the system SHALL return the next 50 jobs strictly after the cursor, ordered by `posted_at DESC`

### Requirement: Job filter parameters

The system SHALL accept filter query parameters: `source`, `company`, `remote` (bool), `skill` (repeatable), `salary_min`, `location`, `q` (case-insensitive ILIKE on title+company+summary).

#### Scenario: Multi-skill filter

- **WHEN** the request is `GET /jobs?skill=Go&skill=Kubernetes`
- **THEN** the system SHALL return only jobs whose `skills` array contains BOTH `Go` AND `Kubernetes`

#### Scenario: Free-text search

- **WHEN** the request is `GET /jobs?q=backend%20engineer`
- **THEN** the system SHALL return jobs where `title`, `company`, or `summary` ILIKE-matches `backend engineer`, ranked by recency

### Requirement: Single job detail

The system SHALL expose `GET /jobs/:id` returning the full job record including raw `description`.

#### Scenario: Found

- **WHEN** a client requests an existing job id
- **THEN** the system SHALL return `200 OK` with the full record

#### Scenario: Not found

- **WHEN** a client requests a non-existent id
- **THEN** the system SHALL return `404 Not Found` with a JSON error body `{ "error": "job_not_found" }`

### Requirement: Sources listing

The system SHALL expose `GET /sources` returning each source's last-run metadata: `name`, `last_run_at`, `last_status` (`ok` | `error`), `last_error`, `jobs_fetched`, `embedding_pending_count`.

#### Scenario: Health visibility

- **WHEN** an admin requests `/sources`
- **THEN** the response SHALL clearly indicate if RemoteOK is failing (`last_status: "error"`) while Arbeitnow is healthy, enabling quick diagnosis

### Requirement: Admin-only company management

The system SHALL expose `POST /admin/companies` (admin-key required) to add new ATS boards: `{ "name", "ats_type", "board_slug" }`. Non-admin callers SHALL receive `403 Forbidden`.

#### Scenario: Admin adds a company

- **WHEN** an admin POSTs `{ "name": "Linear", "ats_type": "greenhouse", "board_slug": "linear1" }`
- **THEN** the system SHALL insert the row and respond `201 Created`, and the next Greenhouse cron tick SHALL include Linear

#### Scenario: Non-admin rejected

- **WHEN** an anonymous user POSTs to `/admin/companies`
- **THEN** the system SHALL respond `403 Forbidden` without persisting

### Requirement: CV upload endpoint

The system SHALL expose `POST /cv` (multipart, see `cv-profile` capability) and `GET /cv/:id` returning the parsed profile (without the raw file bytes).

#### Scenario: Retrieve parsed profile

- **WHEN** a client requests `GET /cv/<id>`
- **THEN** the system SHALL return `{ id, filename, contacts, sections, skills, estimated_years_experience, embedding_status }` but SHALL NOT return the raw file bytes or raw_text

### Requirement: Uniform JSON error envelope

All error responses SHALL use the body shape `{ "error": "<snake_case_code>", "message": "<human readable>", "details"?: {} }` and a sensible HTTP status code.

#### Scenario: Validation error

- **WHEN** a client uploads a CV with an unsupported file type
- **THEN** the system SHALL respond `415 Unsupported Media Type` with `{ "error": "unsupported_file_type", "message": "Only PDF, DOCX, and TXT are supported." }`
