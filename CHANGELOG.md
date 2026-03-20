# Changelog

All notable changes to this project will be documented in this file.

## [1.2.0] - 2026-03-20 — Agent Observatory

### Added

- **Agent entity with status tracking.** Agents now have `idle`, `working`, `offline` status. `GET /api/agents` lists all agents with last activity and task count. `GET /api/agents/:id` returns full activity timeline.
- **Task dependencies.** `depends_on` field (JSON array of task IDs) with cycle detection via recursive CTE. Blocked tasks show a red "BLOCKED" badge on the board. Claiming or assigning a blocked task returns 409.
- **Task origin tracking.** `created_from` field links subtasks to parent tasks. Subtask list shown in task detail panel. `GET /api/tasks?parent=X` filters subtasks.
- **Assign and release endpoints.** `POST /api/tasks/:id/assign` pushes a task to an agent. `POST /api/tasks/:id/release` returns a claimed task to Todo. Both update agent status atomically.
- **Stale claim detection.** Tasks claimed for >2 hours are auto-released on board read (write-on-read pattern). Stale agents are set to `offline`. Idempotent and bounded per board.
- **SSE streaming.** `GET /api/tasks/:id/stream?token=` delivers real-time task logs via Server-Sent Events (25s cycles within CF Workers limit). Supports `Last-Event-ID` reconnection. Frontend falls back to 5s polling after 3 SSE failures.
- **Agent Profile panel.** Click an agent name on any task card to open a sheet showing agent identity, status, task count, and full activity timeline.
- **Assign dropdown.** Task detail panel shows available agents with status dots (idle=gray, working=cyan pulse, offline=orange). Includes "Release task" option.
- **Activity log component.** Live-updating log stream with smart scroll (auto-scroll when at top, "N new" button when scrolled away). Color-coded actions.
- **Subtask list component.** Indented list in task detail showing child tasks with status indicators.
- **CLI commands.** `task assign <id> --agent <aid>`, `task release <id>`, `task create --parent <id> --depends-on <ids>`, `task list --parent <id>`, `agent list`.
- **Test framework.** Bootstrapped vitest with shared constants coverage.

### Changed

- **Schema migration** (`0002_v2.sql`): Added `status` to agents, `depends_on` and `created_from` to tasks, expanded `task_logs` CHECK constraint with `assigned`, `released`, `timed_out` actions.
- **Error handling DRY refactor.** Migrated string-matching (`ALREADY_CLAIMED`) to `HTTPException(409)`. Extracted `getTaskWithBoard()` helper.
- **Auth token extraction.** Extracted `validateToken()` from middleware for SSE endpoint reuse.
- **TaskDetail split.** Extracted editable field components into `TaskDetailFields.tsx` (365→236 lines).

## [1.0.0] - 2026-03-20

- Initial release: full kanban loop (human creates → agent claims → executes → completes).
