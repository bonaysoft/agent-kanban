# Agent Kanban

Agent-first kanban board. React SPA + Hono API on Cloudflare Pages + D1.

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## Architecture
- Monorepo: pnpm workspaces
- Frontend: apps/web/ — React + Vite + Tailwind + shadcn/ui
- Backend: apps/web/functions/[[path]].ts — Hono catch-all on Cloudflare Pages Functions
- Database: Cloudflare D1 (SQLite)
- CLI: packages/cli/ — TypeScript, published to npm
- Shared types: packages/shared/ — proper package with build step
- Agent skill: skills/agent-kanban/ — installed via `npx skills add` to target repos

## Patterns
- Data access: thin repo layer (taskRepo.ts, boardRepo.ts, agentRepo.ts, messageRepo.ts) — no raw SQL in route handlers
- Error handling: Hono onError + HTTPException — centralized error envelope { error: { code, message } }
- Claim atomicity: db.batch() for race-condition-free task claims
- Auth: Two identity types — **user** (Better Auth session) and **machine** (@better-auth/api-key). Users manage boards/repos/machines; machines execute tasks (assign/claim/review/release). Data scoped by `userId`. SSE uses `?token=` query param (validated via Better Auth).
- Agent identity: auto-registered in `agents` table on first claim/create. Not tied to API key 1:1.
- Agent status: idle → working (on claim/assign) → idle (on complete/release/cancel with no other active tasks) → offline (on stale timeout)
- Task lifecycle: Todo → Todo+assigned (daemon assign) → In Progress (agent claim) → In Review (agent review+PR) → Done (human complete) or Cancelled (cancel at any stage)
- Task dependencies: `depends_on` JSON array, cycle detection via recursive CTE (taskDeps.ts), `blocked` computed on read
- Task origin: `created_from` for single-level subtask tracking
- Stale detection: write-on-read in GET /api/boards/:id and inline before assign (taskStale.ts). 2h timeout, idempotent.
- SSE: TransformStream-based, 2s poll for 25s (CF Workers limit), Last-Event-ID resume via log ID → timestamp resolution (sse.ts). Emits typed events (`event: log` for task_logs, `event: message` for messages).
- Messages: `messages` table for human ↔ agent chat. `agent_id` = agent CLI session ID (used for `claude --resume`). D1 as message bus — daemon polls for human messages, browser reads via SSE.
- Machine daemon: `ak start` — poll loop, auto-claim todo tasks, spawn agent CLI per task. PID lock, graceful shutdown, exponential backoff. `processManager.ts` handles spawn/monitor/kill/chat relay.
- Repo linking: `ak link` registers repo at tenant level and maps local directory to repository ID. Stored in `~/.agent-kanban/links.json`.
- Data model: Board is the workspace unit. All data scoped by `user_id`. Tasks belong to boards, optionally linked to a repository. Machines belong to users, API keys managed by Better Auth.

## Testing
- Framework: vitest (root `vitest.config.ts`)
- Run: `npx vitest run`
- Tests in `tests/` directory
