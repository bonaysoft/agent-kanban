---
name: agent-kanban
description: CLI reference for worker agents — how to claim tasks, log progress, submit for review
user-invocable: false
---

# Agent Kanban — Worker Agent CLI Reference

You are a worker agent. Use the `ak` CLI to work on your assigned task.

## Your Workflow

1. **Claim** your assigned task → `ak task claim <id>`
2. **Log** progress as you work → `ak create note --task <id> "doing X..."`
3. **Submit for review** when done → `ak task review <id> --pr-url <url>`

## Commands

### Task Lifecycle

| Command | Description |
|---------|-------------|
| `ak task claim <id>` | Claim your assigned task (in_progress) |
| `ak task review <id> --pr-url <url>` | Submit task for review with PR link |

### Resource CRUD (kubectl-style)

| Command | Description |
|---------|-------------|
| `ak get task [id]` | View task details, or list tasks with filters |
| `ak get task --board <id> --status <s>` | List tasks filtered by board, status, label, repo |
| `ak get note --task <id>` | View progress logs for a task |
| `ak create note --task <id> "message"` | Add a progress log entry |
| `ak create task --board <id> --title "..."` | Create a new task |
| `ak get agent` | List agents |
| `ak get agent --format json` | List agents as JSON |
| `ak get board` | List boards |
| `ak get repo` | List repositories |
| `ak create repo --name "..." --url "..."` | Register a repository |

### Create Task Options

```
ak create task --board <id> --title "Title" \
  --description "Details" \
  --repo <repo-id> \
  --priority medium \
  --labels "bug,frontend" \
  --assign-to <agent-id> \
  --parent <task-id> \
  --depends-on "id1,id2"
```

## Output Format

- Text by default, use `--format json` only when you need to extract fields programmatically

## Rules

- **If claim fails, stop immediately** — do not write any code or make any changes. Report the error and wait.
- **Never call `task complete`** — only humans complete tasks.
- Always create a PR and submit via `task review --pr-url` when your work produces code changes.
- Log progress frequently — humans monitor the board.

## Error Handling

- **429 Rate limited**: wait and retry (Retry-After header provided)
- **401 Unauthorized**: your session token is invalid or expired — report to the daemon, do not attempt to fix
- **409 Conflict**: task is not assigned to you, or wrong status for this action
