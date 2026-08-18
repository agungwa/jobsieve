## ADDED Requirements

### Requirement: Admin key entry
The admin console SHALL prompt for the admin API key, store it in
localStorage, attach it as the `x-api-key` header on all admin requests, and
show a clear error when the backend rejects it with 403.

#### Scenario: Wrong key
- **WHEN** the user submits an invalid key
- **THEN** the console displays the 403 error and keeps prompting

#### Scenario: Valid key remembered
- **WHEN** the user reloads the admin page after a successful session
- **THEN** the console loads without re-prompting

### Requirement: Source health dashboard
The admin console SHALL display a table of all ingest sources with name,
last run time, status (ok/error with message), jobs fetched, and embedding
pending count, refreshing on demand and every 60 seconds.

#### Scenario: Failing source visible
- **WHEN** RemoteOK records an error in `sources.last_error`
- **THEN** the source row shows an error state with the message

### Requirement: Job and embedding stats
The admin console SHALL display total, embedded, and pending job counts from
`GET /api/admin/stats`.

#### Scenario: Stats load
- **WHEN** the admin page opens with a valid key
- **THEN** the stats card shows the three counts

### Requirement: Chat usage view
The admin console SHALL list recent chat usage entries from
`GET /api/chat/usage` showing user key, model, prompt/completion tokens,
cached flag, and latency.

#### Scenario: Usage log shown
- **WHEN** any chat requests have been made
- **THEN** the usage table lists them newest-first

### Requirement: ATS board management
The admin console SHALL provide a form to add an ATS board (name, ats_type
dropdown of greenhouse/lever/ashby, board slug) via
`POST /api/admin/companies`, list existing boards with their job counts from
`GET /api/admin/companies`, and offer disable and hard-delete actions
(`DELETE /api/admin/companies/:id`, `?hard=true` with a confirm step).

#### Scenario: Add a board
- **WHEN** the admin fills the form and submits successfully
- **THEN** the new board appears in the list without a manual refresh

#### Scenario: Hard delete requires confirmation
- **WHEN** the admin clicks hard-delete
- **THEN** a confirmation dialog is required before the request is sent
