## Why

jobs-found has a complete backend (jobs, CV parsing, semantic matching, chat)
but is API-only — every workflow requires curl. A web UI makes the product
usable: job seekers can browse jobs, upload a CV, see matches, and chat;
the admin (me) can monitor sources and manage ATS boards without hitting
endpoints by hand.

## What Changes

- Add a `web/` Vite + React SPA with two areas:
  - **User app** — job browsing with filters (`q`, `skill`, `remote`) and
    cursor pagination, job detail view, CV upload with parsed-profile display
    (skills, years, target role, contacts), semantic match list with scores,
    and an AI chat pane (subject to the existing anon rate limit).
  - **Admin console** — gated by the `x-api-key` header (stored client-side
    after entry): source health table, job/embedding stats, chat token usage,
    ATS board management (add / disable / hard-delete).
- Serve the built SPA from Hono in production (`serveStatic` on `web/dist`,
    SPA fallback to `index.html`); in dev, Vite's dev server proxies `/api`
    routes to the backend.
- Prefix existing REST routes with `/api` (mount change only — no handler
  logic changes). **BREAKING** for existing curl consumers: endpoints move
  from `/jobs` to `/api/jobs`, etc.
- No new backend dependencies beyond `web/`'s own package.json
  (react, react-dom, vite, @vitejs/plugin-react).

## Capabilities

### New Capabilities
- `web-app`: User-facing SPA — job search/browse, CV upload + profile view,
  match results, chat pane.
- `admin-console`: Admin SPA area — source health, stats, usage, ATS board
  management behind the admin API key.
- `frontend-delivery`: How the SPA is served (dev proxy, production static
  serving, `/api` prefix contract).

### Modified Capabilities
<!-- None: existing API behavior is unchanged; only the mount prefix moves. -->

## Impact

- `src/index.ts` — mount routers under `/api`, add static serving + SPA fallback.
- New `web/` directory (separate Vite project, own package.json).
- `.gitignore` — ignore `web/dist`, `web/node_modules`.
- README — document `bun run dev:web`, build, and the `/api` prefix.
- Existing curl examples in README move to `/api/...`.
