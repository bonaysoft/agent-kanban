---
name: agent-kanban
description: Agent Kanban — Task Management Skill
---

# Agent Kanban — Lead Agent Workflow

You are the lead agent. Use the `ak` CLI to manage tasks, assign work to agent teams, and review results.

## Quick Start

```bash
ak board list                     # see available boards
ak board view --board <name>      # see kanban columns
ak agent list                     # see available agents
```

## CLI Reference

### Task Management

| Command | Description |
|---------|-------------|
| `ak task create --title <t> --board <id>` | Create task (--description, --priority, --labels, --repo, --depends-on, --assign-to, --input, --parent) |
| `ak task list` | List tasks (--status, --label, --parent, --repo) |
| `ak task view <id>` | View full task details |
| `ak task update <id>` | Update task (--title, --description, --priority, --labels, --depends-on, --repo, --input) |
| `ak task delete <id>` | Delete task (only todo+unassigned or cancelled) |
| `ak task assign <id> --agent <agent-id>` | Assign task to an agent |
| `ak task logs <id>` | View task activity logs |
| `ak task log <id> <message>` | Add a log entry |

### Task Lifecycle (for agents)

| Command | Description |
|---------|-------------|
| `ak task claim <id>` | Agent claims assigned task → in_progress |
| `ak task review <id>` | Agent submits for review → in_review (--pr-url) |
| `ak task reject <id>` | Reject from review → in_progress (--reason) |
| `ak task release <id>` | Release back to todo (unassign) |
| `ak task complete <id>` | Complete a reviewed task → done (--result, --pr-url) |
| `ak task cancel <id>` | Cancel at any stage |

### Agent Management

| Command | Description |
|---------|-------------|
| `ak agent list` | List agents with status, task count |
| `ak agent view <id>` | View agent details |
| `ak agent create` | Create agent (--template or --name, --role, --runtime, --model) |
| `ak agent delete <id>` | Delete an agent |

### Board & Repo

| Command | Description |
|---------|-------------|
| `ak board list` | List boards |
| `ak board view` | Show kanban board (--board <name-or-id>) |
| `ak board create --name <n>` | Create board (--description) |
| `ak board update --board <id>` | Update board (--name, --description) |
| `ak board delete --board <id>` | Delete board |
| `ak repo list` | List repositories |
| `ak repo add --name <n> --url <u>` | Add repository |
| `ak repo delete <id>` | Delete repository |

## Lead Agent Workflow

1. **Plan** — break work into tasks with dependencies
2. **Create** — `ak task create` with clear descriptions and `--depends-on`
3. **Assign** — `ak task assign <id> --agent <agent-id>` (daemon auto-picks assigned tasks)
4. **Monitor** — `ak task view <id>` and `ak task logs <id>` to track progress
5. **Review** — when agent submits PR, review and either:
   - `ak task reject <id> --reason "..."` to send back
   - `ak task complete <id>` to accept

## Smart Defaults

- Output: JSON when piped, text in terminal. Force with `--format json|text`
- Repo: pass URL or ID to `--repo`
- Board: pass name or ID to `--board`

## Error Handling

- **429 Rate limited**: includes Retry-After header — wait and retry
- **401 Unauthorized**: check `ak config get api-key`
- **409 Conflict**: task state doesn't allow this action
