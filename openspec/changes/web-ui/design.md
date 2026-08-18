## Context

The backend is complete: Hono on :3000 exposes jobs/search, CV upload+parse,
match, chat (rate-limited), and admin endpoints (sources, stats, ATS boards).
Everything is JSON-only today. The user wants a browser interface covering
both roles. Bun is the runtime; `bun run dev` hot-reloads the backend.

## Goals / Non-Goals

**Goals:**
- A Vite + React SPA in `web/` covering the user journey end-to-end:
  search → job detail → upload CV → see profile → matches → chat.
- An admin console behind the admin API key: sources, stats, chat usage,
  ATS board CRUD.
- One-process production deploy: Hono serves the built SPA.
- Fast dev loop: Vite HMR proxying to the Bun backend.

**Non-Goals:**
- No auth system beyond the existing `x-api-key` (no sessions/JWT).
- No SSR, no SEO concerns.
- No CSS framework; one hand-written stylesheet.
- No new backend features except the `/api` mount prefix + static serving.

## Decisions

1. **React (not Preact)** — React's DX and ecosystem win; bundle size is
   irrelevant for an internal tool. Alternative: Preact (+3kB) — rejected as
   a micro-optimization that complicates types.

2. **`web/` is a separate Vite project with its own package.json** — keeps
   the backend's tsc/bun pipeline untouched (React JSX types would pollute
   `src/`). Root convenience scripts (`dev:web`, `build:web`) call into it.

3. **All API routes move under `/api`** — the SPA needs a stable prefix to
   proxy and to distinguish API 404s from SPA routes. Mount-level change in
   `index.ts` only. Alternative: keep root paths + proxy allowlist — rejected
   (fragile; every new route needs proxy edits).

4. **Dev: Vite proxy, Prod: Hono static** — `web/vite.config.ts` proxies
   `/api` → `localhost:3000`. Production: `Bun.serve` serves `web/dist`
   assets with fallback to `index.html` for SPA routes; `/api/*` skips the
   fallback.

5. **Data fetching: hand-rolled hooks (no react-query)** — the API surface is
   ~8 endpoints; a 40-line `useApi` hook + fetch wrapper with abort covers
   it. Alternative: @tanstack/react-query — rejected as dependency weight
   for this scope.

6. **Routing: react-router** — two areas (`/`, `/jobs/:id`, `/cv/:id`,
   `/match/:cvId`, `/chat`, `/admin/*`) need real URLs; hash routing breaks
   shareable links.

7. **Admin key handling** — entered once on the admin page, stored in
   `localStorage`, attached as `x-api-key` by the fetch wrapper. No login
   flow; the backend already returns 403 for wrong keys. (Accepted risk:
   localStorage XSS — the SPA renders no user HTML, mitigated by React
   escaping.)

8. **Active CV id in localStorage** — after upload, the app remembers the
   CV id so /match and /chat reference it without re-upload.

## Risks / Trade-offs

- [BREAKING `/api` prefix for existing curl users] → README updated; one-line
  change; documented in proposal.
- [Chat failures while GLM balance is empty] → UI renders the backend's
  error envelope (429/502) inline instead of crashing.
- [Two dev processes in development] → root `dev:web` script runs Vite only
  (backend assumed running via `bun run dev`); documented in README.
- [SPA fallback could shadow API 404s] → fallback only applies to non-`/api`
  GETs.

## Migration Plan

1. Add `web/` project; build works against existing endpoints.
2. Move mounts to `/api` + add static serving; update README curl examples.
3. Rollback: revert `src/index.ts` mount change; `web/` is additive.

## Open Questions

- None blocking. (Anon rate-limit UX could later show remaining count from
  the `x-ratelimit-remaining` header — nice-to-have, not specced.)
