---
name: agent-kanban
description: Task management skill for the Agent Kanban CLI — claim, log, complete tasks
---

# Agent Kanban — Task Management Skill

Use the `agent-kanban` CLI (alias `ak`) to manage tasks on your kanban board.

## Setup

```bash
npm install -g agent-kanban
ak config set api-url https://your-instance.pages.dev
ak config set api-key <your-api-key>
```

## Workflow

When the daemon assigns you a task, you receive the task ID. Follow this flow:

### 1. View the task

```bash
ak task list --format json
```

Find your assigned task and read the details.

### 2. Claim the task

```bash
ak task claim <task-id> --agent-name <your-name>
```

This confirms you are starting work and moves the task to "In Progress."

### 3. Do the work

Read the task description, implement the changes, run tests, etc.

### 4. Log progress

```bash
ak task log <task-id> "Investigating the auth flow..."
ak task log <task-id> "Root cause: breaking change in v2.3"
```

### 5. Complete the task

```bash
ak task complete <task-id> \
  --result "Fixed JWT claim namespace" \
  --pr-url "https://github.com/org/repo/pull/42" \
  --agent-name <your-name>
```

## Task Lifecycle

```
Todo ──assign(daemon)──→ Todo (assigned) ──claim(agent)──→ In Progress
  → In Review (review) → Done (complete)
  → Cancelled (cancel at any stage)
  → Todo (release — on crash or timeout)
```

- **assign**: Daemon locks the task to you. Status stays `todo`, but no other agent can take it.
- **claim**: You confirm you're starting. Status moves to `in_progress`.
- **complete**: You're done. Status moves to `done`.
- **review**: Move to `in_review` for human review before completing.

## Creating Subtasks

When you discover follow-up work, create a task:

```bash
ak task create \
  --title "Fix shared-lib JWT claim namespace" \
  --priority high \
  --agent-name <your-name>
```

Log the relationship:

```bash
ak task log <original-task-id> "Created subtask for shared-lib fix"
```

## CLI Reference

| Command | Description |
|---------|-------------|
| `task create --title <t>` | Create a task (optional: --priority, --labels, --input) |
| `task list` | List tasks (optional: --status, --label, --format) |
| `task claim <id>` | Claim an assigned task — start working |
| `task log <id> <msg>` | Add a progress log entry |
| `task review <id>` | Move task to In Review |
| `task complete <id>` | Mark task done (optional: --result, --pr-url) |
| `task cancel <id>` | Cancel a task |
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

## Best Practices

1. Always claim before working — don't start without claiming
2. Log progress frequently — humans monitor the board
3. Create subtasks when you find dependency gaps
4. Include PR URLs when completing — it closes the loop
5. Use meaningful agent names for traceability
