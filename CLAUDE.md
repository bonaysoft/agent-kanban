# Agent Kanban

Agent-first cross-project kanban board. React SPA + Hono API on Cloudflare Pages + D1.

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
- Agent skill: packages/skill/ — installed to ~/.claude/skills/agent-kanban/

## Patterns
- Data access: thin repo layer (taskRepo.ts, boardRepo.ts, agentRepo.ts, projectRepo.ts, messageRepo.ts) — no raw SQL in route handlers
- Error handling: Hono onError + HTTPException — centralized error envelope { error: { code, message } }
- Claim atomicity: db.batch() for race-condition-free task claims
- Auth: API key = Machine level (one key per computer, all agents share it). SHA-256 hashed in D1. Bootstrap via wrangler d1 execute. SSE uses `?token=` query param (validated via `validateToken()`).
- Agent identity: auto-registered in `agents` table on first claim/create. Not tied to API key 1:1.
- Agent status: idle → working (on claim/assign) → idle (on complete/release/cancel with no other active tasks) → offline (on stale timeout)
- Task lifecycle: Todo → In Progress (claim/assign) → In Review (review) → Done (complete) or Cancelled (cancel at any stage)
- Task dependencies: `depends_on` JSON array, cycle detection via recursive CTE (taskDeps.ts), `blocked` computed on read
- Task origin: `created_from` for single-level subtask tracking
- Stale detection: write-on-read in GET /api/boards/:id and inline before assign (taskStale.ts). 2h timeout, idempotent.
- SSE: TransformStream-based, 2s poll for 25s (CF Workers limit), Last-Event-ID resume via log ID → timestamp resolution (sse.ts). Emits typed events (`event: log` for task_logs, `event: message` for messages).
- Messages: `messages` table for human ↔ agent chat. `agent_id` = agent CLI session ID (used for `claude --resume`). D1 as message bus — daemon polls for human messages, browser reads via SSE.
- Machine daemon: `ak start` — poll loop, auto-claim todo tasks, spawn agent CLI per task. PID lock, graceful shutdown, exponential backoff. `processManager.ts` handles spawn/monitor/kill/chat relay.
- Repo linking: `ak link` registers repo at tenant level and maps local directory to repository ID. Stored in `~/.agent-kanban/links.json`. `--project` optional for directory-to-project association.
- Data model: Project is the workspace unit. Board is 1:1 with project. Repositories belong to owner (tenant-level, like machines) — not project-scoped. Tasks belong to boards, optionally linked to a repository. Machines belong to owner (user/org).

## Testing
- Framework: vitest (root `vitest.config.ts`)
- Run: `npx vitest run`
- Tests in `tests/` directory
