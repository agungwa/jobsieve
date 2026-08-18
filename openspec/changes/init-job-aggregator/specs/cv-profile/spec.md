## ADDED Requirements

### Requirement: CV upload acceptance

The system SHALL accept CV uploads via `POST /cv` with `multipart/form-data` containing a single file in PDF, DOCX, or TXT format, up to 10 MB. On success the system SHALL respond with the created CV id and persist the original file bytes and extracted text.

#### Scenario: PDF upload

- **WHEN** a user uploads a valid 200 KB PDF
- **THEN** the system SHALL respond `201 Created` with `{ "id": "<uuid>" }` and store both the raw file and extracted plain text

#### Scenario: Oversized file rejected

- **WHEN** a user uploads an 11 MB file
- **THEN** the system SHALL respond `413 Payload Too Large` and not persist anything

### Requirement: Deterministic text extraction (no AI)

The system SHALL extract plain text from CV files using only deterministic libraries (`pdf-parse` with `unpdf` fallback for PDF, `mammoth` for DOCX, direct read for TXT). The extraction step SHALL NOT make any LLM or embedding API call.

#### Scenario: PDF extraction under Bun

- **WHEN** a PDF is uploaded and `pdf-parse` throws a "no module parent" error under Bun
- **THEN** the system SHALL automatically retry with `unpdf` and still produce extracted text

#### Scenario: DOCX extraction

- **WHEN** a DOCX file is uploaded
- **THEN** the system SHALL use `mammoth.extractRawText()` and return the plain-text body

### Requirement: Contact extraction via regex

The system SHALL extract from the raw CV text, using regex only: email, phone (E.164-tolerant), GitHub URL, LinkedIn URL, personal URL. The system SHALL NOT call any AI service for contact extraction.

#### Scenario: Email extraction

- **WHEN** CV text contains "Contact: jane.doe@example.com"
- **THEN** the parsed profile SHALL include `contacts.email = "jane.doe@example.com"`

#### Scenario: Missing fields are null

- **WHEN** CV text contains no GitHub URL
- **THEN** `contacts.github` SHALL be `null`, not an empty string

### Requirement: Section detection via heading heuristics

The system SHALL split extracted text into sections (e.g. `experience`, `education`, `skills`, `projects`, `summary`) by detecting line-level headings (case-insensitive match against a known heading dictionary, accounting for colon suffixes and all-caps lines).

#### Scenario: Standard section names

- **WHEN** the CV contains a line "WORK EXPERIENCE" followed by a list
- **THEN** the parser SHALL create a `sections.experience` array containing the subsequent lines until the next recognized heading

### Requirement: Skills extraction via dictionary matching

The system SHALL maintain a skills dictionary (`data/skills.json`) of canonical skill names plus aliases, seeded from the Tanova 139-skill tech taxonomy. The system SHALL match the CV text against this dictionary using the Aho-Corasick algorithm (one pass over text, all patterns) and return a list of `{ skill, occurrences, first_position }` matches.

#### Scenario: Canonical name wins over alias

- **WHEN** the CV contains "TS" and the alias map says `TS → TypeScript`
- **THEN** the matched skill SHALL be recorded as `TypeScript` (canonical), not `TS`

#### Scenario: Multiple skills matched in one pass

- **WHEN** the CV contains "Built APIs in Node, React, and PostgreSQL"
- **THEN** the parser SHALL return `["Node", "React", "PostgreSQL"]` (canonical names) in a single scan

### Requirement: Years of experience estimation

The system SHALL estimate years of experience by scanning for date ranges (e.g. `2020 - 2023`, `Mar 2018 - Present`) in the experience section and summing the spans. The result SHALL be stored as `estimated_years_experience`.

#### Scenario: Date range arithmetic

- **WHEN** the experience section contains "Software Engineer, Acme (Jan 2020 - Dec 2023)"
- **THEN** `estimated_years_experience` SHALL be incremented by ~4.0 years for that span

### Requirement: Structured CVProfile schema

The system SHALL persist a structured `CVProfile` alongside the raw text: `id`, `filename`, `raw_text`, `contacts` (json), `sections` (json), `skills` (array of `{skill, occurrences}`), `estimated_years_experience` (number, nullable), `embedding_status` (`pending` | `embedded` | `failed`), `created_at`, `updated_at`.

#### Scenario: Profile created without AI

- **WHEN** a 3-page PDF CV is uploaded and processed end-to-end
- **THEN** the `cv_profiles` row SHALL be fully populated (contacts, sections, skills, years) and `embedding_status` SHALL be `pending` — and the total wall-clock cost SHALL include zero LLM tokens

### Requirement: One-shot CV embedding

A background worker (same cron driver as jobs) SHALL pick up CVs with `embedding_status: 'pending'`, embed the composite text `title + top_skills + experience_summary + target_role` (not the raw CV) at 512 dimensions, and store the vector.

#### Scenario: Embedding decoupled from upload

- **WHEN** a CV is uploaded while the GLM embedding API is down
- **THEN** the upload SHALL still return `201 Created`, the row SHALL have `embedding_status: 'pending'`, and the worker SHALL embed it when the API recovers
