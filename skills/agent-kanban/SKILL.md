---
name: agent-kanban
description: CLI reference for the Agent Kanban task management tool
---

# Agent Kanban — CLI Reference

Use the `agent-kanban` CLI (alias `ak`) to manage tasks on your kanban board.

## Setup

```bash
npm install -g agent-kanban
ak config set api-url https://your-instance.pages.dev
ak config set api-key <your-api-key>
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `task create --title <t>` | Create a task (optional: --description, --priority, --labels, --input, --assign-to, --parent, --depends-on, --repo) |
| `task list` | List tasks (optional: --status, --label, --parent, --repo, --format) |
| `task claim <id>` | Claim an assigned task — start working |
| `task log <id> <msg>` | Add a progress log entry |
| `task review <id>` | Submit for review (optional: --pr-url) |
| `task cancel <id>` | Cancel a task |
| `task complete <id>` | Complete a task (optional: --result, --pr-url) |
| `agent list` | List all agents (shows id, name, role, status) |
| `board list` | List all boards |
| `board view` | Show the kanban board |
| `config set <key> <val>` | Set api-url or api-key |

## Smart Defaults

- Output is JSON when piped (not a TTY), text in interactive terminals
- Use `--format json` to force JSON output

## Error Handling

- **401 Unauthorized**: Check your API key with `ak config get api-key`
- **409 Conflict**: Task is already claimed or not assigned to you
- **404 Not Found**: Task ID doesn't exist — check with `task list`
