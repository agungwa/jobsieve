## ADDED Requirements

### Requirement: API prefix
The backend SHALL serve all existing REST routes under the `/api` prefix
(e.g. `GET /api/jobs`, `POST /api/cv`, `POST /api/chat`,
`GET /api/admin/stats`). Handler behavior SHALL be unchanged.
`GET /healthz` SHALL remain at the root (unprefixed) for uptime monitors.

#### Scenario: Existing endpoint under prefix
- **WHEN** a client requests `GET /api/jobs?limit=5`
- **THEN** the response is identical to the previous `GET /jobs?limit=5`

#### Scenario: Health stays at root
- **WHEN** a monitor requests `GET /healthz`
- **THEN** it gets the health JSON without the `/api` prefix

### Requirement: Development proxy
In development, the Vite dev server SHALL proxy `/api` requests to the
backend (default `http://localhost:3000`) so the SPA runs on the Vite port
with no CORS configuration needed.

#### Scenario: SPA calls API in dev
- **WHEN** the app running under `vite dev` fetches `/api/jobs`
- **THEN** the request is served by the backend on port 3000

### Requirement: Production static serving
In production, the backend SHALL serve the built SPA from `web/dist`:
static assets at their paths, and any non-`/api` GET that does not match a
file SHALL fall back to `index.html` (SPA routing).

#### Scenario: Deep link after build
- **WHEN** a user opens `/jobs/<uuid>` directly against the served build
- **THEN** the SPA loads and renders that route (no 404)

#### Scenario: API 404s are not shadowed
- **WHEN** a request to `/api/does-not-exist` 404s
- **THEN** the response is the API's JSON 404, not `index.html`

### Requirement: Root dev scripts
The repository root SHALL expose `dev:web` (Vite dev server) and
`build:web` (production build into `web/dist`) npm scripts.

#### Scenario: Build produces servable output
- **WHEN** `build:web` completes and the backend serves `web/dist`
- **THEN** opening `/` shows the app
