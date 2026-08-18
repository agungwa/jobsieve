## ADDED Requirements

### Requirement: Job search and browsing
The web app SHALL provide a jobs page that lists jobs with title, company,
location, seniority, and posted date, supporting the `q` (text), `skill`
(repeatable), and `remote=true` filters, and cursor-based pagination
("Next page" / "Previous page").

#### Scenario: Filter by skill
- **WHEN** the user types "react" into the skill filter and the list refreshes
- **THEN** only jobs whose skills include "react" are shown

#### Scenario: Paginate with cursor
- **WHEN** the user clicks "Next page" after the first 20 results
- **THEN** the app requests the next page using the cursor from the previous
  response and appends-or-replaces the list accordingly

### Requirement: Job detail view
The web app SHALL provide a job detail page showing title, company, location,
salary (when present), posted date, skills, source link (external URL), and
the full description when available.

#### Scenario: View a job
- **WHEN** the user clicks a job in the list
- **THEN** the app navigates to the job's detail page populated from
  `GET /api/jobs/:id`

#### Scenario: Unknown job
- **WHEN** the user opens a detail URL for a job id that does not exist
- **THEN** the page shows a "not found" message with a link back to the list

### Requirement: CV upload and profile view
The web app SHALL provide a CV upload control accepting PDF/DOCX/TXT up to
10 MB, submitting to `POST /api/cv`, and after upload SHALL navigate to a
profile page showing the parsed contacts, skills with occurrence counts,
estimated years of experience, target role, and embedding status
(pending → embedded with automatic refresh).

#### Scenario: Successful upload
- **WHEN** the user selects a valid PDF and the upload succeeds
- **THEN** the app navigates to the CV profile page and shows the parsed
  profile fields from `GET /api/cv/:id`

#### Scenario: Unsupported type rejected client-side
- **WHEN** the user selects a file with an extension other than
  pdf/docx/doc/txt/md
- **THEN** the app shows an inline error without sending a request

#### Scenario: Oversize file
- **WHEN** the user selects a file larger than 10 MB
- **THEN** the app shows the server's 413 error inline

#### Scenario: Embedding status transitions
- **WHEN** the profile page is opened while `embeddingStatus` is `pending`
- **THEN** the page polls `GET /api/cv/:id` until the status becomes
  `embedded` or `failed` (max 10 attempts, 5s apart)

### Requirement: Match results
The web app SHALL provide a match view for an uploaded CV showing ranked
jobs with their similarity score (as a percentage), linking each result to
the job detail page, with optional `remote` and `skill` filters passed
through to the API.

#### Scenario: View matches after upload
- **WHEN** the CV's embedding status becomes `embedded`
- **THEN** the app fetches `GET /api/match?cv_id=<id>` and lists jobs ordered
  by score with a visible score on each row

#### Scenario: CV not yet embedded
- **WHEN** the match view loads while the CV is still `pending`
- **THEN** the app shows a "still processing" state and retries

### Requirement: Chat pane
The web app SHALL provide a chat interface that submits
`POST /api/chat` with the user's message and the active CV id (when set),
renders the reply, shows the `cached` and `model` flags per message, and
displays rate-limit errors (429) with their retry-after message inline.

#### Scenario: Ask a question
- **WHEN** the user types a message and submits it
- **THEN** the app posts to `/api/chat`, disables the input while pending,
  and appends the reply to the conversation view

#### Scenario: Rate limited
- **WHEN** the API returns 429
- **THEN** the app shows the error message with the retry hint instead of a
  reply and re-enables the input

### Requirement: Active CV persistence
The web app SHALL remember the most recently uploaded CV id in
localStorage and use it as context for the match view and chat, showing the
CV's target role where relevant, and SHALL allow the user to clear it.

#### Scenario: Return visit
- **WHEN** the user reloads the app after previously uploading a CV
- **THEN** the match view and chat context use the remembered CV id without
  re-upload
