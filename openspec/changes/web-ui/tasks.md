## 1. Backend delivery changes

- [x] 1.1 Mount all REST routers under `/api` in `src/index.ts` (healthz stays at root); verify `GET /api/jobs`, `POST /api/cv`, `POST /api/chat` behave identically
- [x] 1.2 Add static serving of `web/dist` with SPA fallback (non-`/api` GET without a matching file returns `index.html`)
- [x] 1.3 Update README curl examples to the `/api` prefix and document `dev:web` / `build:web`

## 2. Vite project scaffold

- [x] 2.1 Create `web/` Vite + React + TypeScript project with own package.json; add root `dev:web` and `build:web` scripts; gitignore `web/dist` and `web/node_modules`
- [x] 2.2 Configure Vite proxy `/api` → `http://localhost:3000`
- [x] 2.3 Create shared API client (`web/src/api.ts`): fetch wrapper attaching `x-api-key` from localStorage, typed response helpers, error envelope parsing
- [x] 2.4 Set up react-router with routes: `/` (jobs), `/jobs/:id`, `/cv/:id`, `/match`, `/chat`, `/admin/*`; base layout + navigation + single stylesheet

## 3. User app — jobs

- [x] 3.1 Jobs list page: filters (`q`, skill, remote toggle), 20-per-page list, cursor "Next/Previous" pagination
- [x] 3.2 Job detail page: all fields, skills, salary, external link, description; 404 state with link back

## 4. User app — CV, match, chat

- [x] 4.1 CV upload control on the jobs page header: client-side type/size validation, `POST /api/cv`, navigate to profile on success, inline 413/415/422 errors
- [x] 4.2 CV profile page: contacts, skills with counts, years, target role, embedding status; poll pending → embedded (max 10 × 5s)
- [x] 4.3 Match view: ranked list with score %, job links, remote/skill filters; "still processing" retry state while CV is pending; remember active CV id in localStorage with a clear action
- [x] 4.4 Chat pane: message list, input with pending state, reply rendering with cached/model flags, inline 429 error handling
- [x] 4.5 End-to-end check in dev: upload `jane-cv.txt` → profile embedded → matches listed → chat round-trip (or clean 429/502 while GLM balance is empty)

## 5. Admin console

- [x] 5.1 Admin layout with key gate: prompt for key, store in localStorage, 403 error display
- [x] 5.2 Sources health table (name, last run, status+error, jobs fetched, pending) with manual + 60s auto refresh
- [x] 5.3 Stats card (total/embedded/pending) and chat usage table (user key, model, tokens, cached, latency)
- [x] 5.4 ATS boards page: add form (name, ats_type dropdown, board slug), board list with job counts, disable + hard-delete (confirm dialog)
- [x] 5.5 Admin verify: wrong key → 403 shown; correct key → sources/stats/boards all render; add + disable a board round-trip

## 6. Production build verification

- [x] 6.1 `build:web` succeeds; backend serves the SPA from `web/dist`; deep link `/jobs/<uuid>` loads; `/api/*` 404 stays JSON; final `bun run typecheck` clean
