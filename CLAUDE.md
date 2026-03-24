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
- Auth: Three identity types — **user** (Better Auth session), **machine** (@better-auth/api-key), **agent** (@better-auth/agent-auth Ed25519 JWT). Machines assign tasks; agents claim/review with own JWT. Data scoped by `owner_id`.
- Agent identity: registered via `POST /api/agents` with Ed25519 public key. Each agent has a cryptographic identity (identicon, fingerprint). Daemon generates ephemeral keypair per spawn.
- Agent status: idle → working (on claim/assign) → idle (on complete/release/cancel with no other active tasks) → offline (on stale timeout)
- Task lifecycle: Todo → Todo+assigned (daemon assign) → In Progress (agent claim) → In Review (agent review+PR) → Done (human complete) or Cancelled (cancel at any stage)
- Task dependencies: `depends_on` JSON array, cycle detection via recursive CTE (taskDeps.ts), `blocked` computed on read
- Task origin: `created_from` for single-level subtask tracking
- Stale detection: write-on-read in GET /api/boards/:id and inline before assign (taskStale.ts). 2h timeout, idempotent.
- SSE: TransformStream-based, 2s poll for 25s (CF Workers limit), Last-Event-ID resume via log ID → timestamp resolution (sse.ts). Emits typed events (`event: log` for task_logs, `event: message` for messages).
- Messages: `messages` table for human ↔ agent chat. `agent_id` = agent CLI session ID (used for `claude --resume`). D1 as message bus — daemon polls for human messages, browser reads via SSE.
- Machine daemon: `ak start` — poll loop, auto-claim todo tasks, spawn agent CLI per task. PID lock, graceful shutdown, exponential backoff. `processManager.ts` handles spawn/monitor/kill/chat relay.
- Repo linking: `ak link` registers repo at tenant level and maps local directory to repository ID. Stored in `~/.agent-kanban/links.json`.
- Data model: Board is the workspace unit. Repositories belong to owner (tenant-level, like machines). Tasks belong to boards, optionally linked to a repository. Machines belong to owner (user/org).

## Post-Write Workflow
After every significant code change, follow this sequence:

1. **Test** — invoke test-writer agent to write/update tests and run them.
   - ALL PASS → proceed to step 2.
   - FAILURES → you (main agent) read the failure, decide if the bug is in source code or test code.
     - Source bug → fix the source code, re-run tests yourself.
     - Test bug → state why the test is wrong, then forward to test-writer agent to fix.
   - After all tests pass, proceed to step 2.
2. **Review** — invoke clean-code-reviewer agent (reviews both source and test code).
   - REVISE on source code → you (main agent) fix, then re-run review.
   - REVISE on test code → forward issues to test-writer agent to fix.
   - PASS → proceed to step 3.

**Ownership rule**: you (main agent) only modify source code. Test code is owned by the test-writer agent — all test modifications go through it.
3. **Regression** — run build + type check + full test suite to catch breakage.
   - `pnpm build && pnpm tsc --noEmit && npx vitest run`
   - Any failure → fix and re-run. If fix touches source code, go back to step 1.

## Testing
- Framework: vitest (root `vitest.config.ts`)
- Run: `npx vitest run`
- Run with coverage: `npx vitest run --coverage --coverage.include='<glob>'`
- Coverage provider: `@vitest/coverage-v8` (install with `pnpm add -Dw @vitest/coverage-v8` if missing)
- Tests in `tests/` directory
- Unit/integration tests: `*.test.ts` — direct import of modules, real D1 via Miniflare (no mocks)
- E2E tests: `*.spec.ts` — Playwright browser tests
- Test data setup: Miniflare D1 with migrations from `apps/web/migrations/`, seed helpers in test files
