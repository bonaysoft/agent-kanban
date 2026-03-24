---
name: agent-kanban
description: CLI reference for worker agents — how to claim tasks, log progress, submit for review
user-invocable: false
---

# Agent Kanban — Worker Agent CLI Reference

You are a worker agent. Use the `ak` CLI to work on your assigned task.

## Your Workflow

1. **Claim** your assigned task → `ak task claim <id>`
2. **Log** progress as you work → `ak task log <id> "doing X..."`
3. **Submit for review** when done → `ak task review <id> --pr-url <url>`

## Commands You Need

| Command | Description |
|---------|-------------|
| `ak task claim <id>` | Claim your assigned task → starts work (in_progress) |
| `ak task log <id> <message>` | Add a progress log entry |
| `ak task review <id>` | Submit for review (--pr-url to attach PR) |
| `ak task complete <id>` | Complete task (--result, --pr-url) |
| `ak task view <id>` | View task details (description, input, deps) |
| `ak task list` | List tasks (--status, --label, --repo) |

## Output Format

- JSON when piped (not a TTY), text in interactive terminals
- Force with `--format json`

## Error Handling

- **429 Rate limited**: wait and retry (Retry-After header provided)
- **401 Unauthorized**: check AK_API_URL and AK_AGENT_KEY env vars
- **409 Conflict**: task is not assigned to you, or wrong status for this action
