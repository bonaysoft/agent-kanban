# TODOS

## API

### Task Dependency Chains

**What:** Add `depends_on` JSON array field to tasks, cycle detection via DFS, blocked UI badge, and 409 on /claim with unmet dependencies.

**Why:** Foundation for v2 orchestrator — without dependency awareness, auto-dispatch is just round-robin. Enables multi-step workflows where task B can't start until task A completes.

**Context:** CEO plan specified the full design: `depends_on TEXT` column storing JSON array of task IDs, computed `blocked` boolean on read, DFS cycle detection on write, and `/claim` returning 409 Conflict if any dependency is not in "Done" column. Deferred from v1 to reduce scope — the core "human creates → agent executes" loop works without dependencies. Implement when building the v2 central orchestrator agent.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Task Origin Tracking (parent_task / created_from)

**What:** Add optional `created_from` field to tasks. When an agent creates a subtask during execution of another task, it can link back to the parent task.

**Why:** When agents autonomously create tasks (e.g., discovering a dependency gap while working), the relationship between parent and child tasks is lost. This makes it hard to understand why a task exists and trace the chain of work.

**Context:** v1 already supports agents creating tasks via CLI (`task create`). The `created_by` field records which agent created it, but not which task it was spawned from. The workaround in v1 is logging context manually (`task log abc123 "Created subtask def456"`), but this is unstructured text. A proper `created_from TEXT` field (nullable, references tasks.id) would enable the UI to show task trees and the CLI to query subtasks. Distinct from `depends_on` — `created_from` is provenance ("where did this come from"), `depends_on` is execution ordering ("what blocks this").

**Effort:** S
**Priority:** P2
**Depends on:** None

### GitHub PR Status Integration

**What:** Fetch and cache PR status (open/merged/closed) from GitHub API. Display colored badge on task cards with `pr_url`.

**Why:** Closes the feedback loop — board shows "code actually shipped" not just "agent says done." Users can see at a glance which PRs merged.

**Context:** CEO plan specified: `pr_status_cache` D1 table (pr_url PK, status, fetched_at), stale-while-revalidate via CF `waitUntil()`, 60s TTL with GITHUB_TOKEN / 5min without, refresh only on individual task reads. Optional `GITHUB_TOKEN` CF env var. Graceful degradation: if no token or GitHub unreachable, show `pr_url` as plain link. Deferred from v1 — adds external API dependency and cache management complexity.

**Effort:** M
**Priority:** P2
**Depends on:** None

### Stale Claim Detection

**What:** Auto-release tasks claimed by agents that don't complete within a configurable timeout (default: 2 hours).

**Why:** Prevents tasks from being stuck in "In Progress" forever when an agent crashes or times out. Important for reliability once agents run unsupervised.

**Context:** CEO plan specified: check on every `GET /api/tasks` — if claimed log exists, no completed log, and `now - claimed_at > timeout`, auto-release to "Todo" column and log `timed_out` action. No separate cron needed. Deferred from v1 — edge case until real agent usage patterns emerge.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Pagination on List Endpoints

**What:** Cursor-based pagination on `GET /api/tasks` and `GET /api/boards` with `after=<id>&limit=20` params.

**Why:** Prevents unbounded response sizes as task count grows. Required before task count hits hundreds.

**Context:** CEO plan specified: default limit 50, max 100, `next_cursor` field in response (null if no more). CLI auto-paginates by default, `--limit N` to cap. Deferred from v1 — unnecessary at personal scale initially.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Task Archiving

**What:** Add `archived_at TEXT` column. `PATCH /api/tasks/:id` with `{ archived: true }` sets timestamp. Archived tasks excluded from lists by default, `?include_archived=true` to include.

**Why:** Clean board UX once completed tasks accumulate. Soft-delete without losing history.

**Context:** CEO plan specified: CLI commands `task archive <id>` and `task list --archived`. Deferred from v1 — not needed until enough tasks accumulate to clutter the board.

**Effort:** S
**Priority:** P4
**Depends on:** None

## Web UI

### Keyboard Shortcuts

**What:** Custom `useKeyboardShortcuts` React hook with n (new task), / (search), arrows (navigate), Enter (open detail), Esc (close), 1-9 (move to column N), ? (help overlay).

**Why:** Power-user UX. Screenshot-worthy for demos. Browser-agent-friendly (navigate by keyboard).

**Context:** CEO plan specified: disabled when text input is focused. Deferred from v1 — polish feature, not core functionality.

**Effort:** S
**Priority:** P3
**Depends on:** None

### Drag-and-Drop for Kanban Board

**What:** Add drag-and-drop to move cards between columns using @dnd-kit/core.

**Why:** Expected UX for kanban boards. Natural way for humans to manually move tasks between columns.

**Context:** Deferred from v1 per design review — agents are the primary card movers (via /claim and /complete API). Humans rarely need manual column moves. Currently, cards are moved via a dropdown in the detail slide-out panel. Implementation is ~100 lines with @dnd-kit. Desktop only — mobile uses tab switcher where drag doesn't apply.

**Effort:** S
**Priority:** P3
**Depends on:** None

## Completed

### Full Design System (DESIGN.md)

**What:** Run `/design-consultation` to create a proper DESIGN.md with full visual language — typography scale, color system, spacing rules, component patterns, motion guidelines.

**Why:** v1 uses minimum viable design tokens (Inter, shadcn/ui defaults). Before adding more UI features in v2, the product needs a stronger visual identity to avoid "generic SaaS" look.

**Context:** Design review rated design system alignment 7/10 with current tokens. A proper DESIGN.md would bring it to 10/10 and ensure consistency as the UI grows. Should be done before v2 UI work (keyboard shortcuts, drag-and-drop, PR status badges, etc.).

**Effort:** S
**Priority:** P2
**Depends on:** None

**Completed:** v1.0.0 (2026-03-20)
