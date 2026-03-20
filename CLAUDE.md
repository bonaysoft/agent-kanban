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
- Data access: thin repo layer (taskRepo.ts, boardRepo.ts) — no raw SQL in route handlers
- Error handling: Hono onError + HTTPException — centralized error envelope { error: { code, message } }
- Claim atomicity: db.batch() for race-condition-free task claims
- Auth: API key = Machine level (one key per computer, all agents share it). SHA-256 hashed in D1. Bootstrap via wrangler d1 execute.
- Agent identity: auto-registered in `agents` table on first claim/create. Not tied to API key 1:1.
