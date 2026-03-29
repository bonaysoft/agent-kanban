---
name: agent-kanban
description: CLI reference for agents — how to claim tasks, log progress, submit for review
user-invocable: false
---

# Agent Kanban — Agent CLI Reference

You are an agent. Use the `ak` CLI to work on tasks. Your identity is initialized automatically on first command — no setup needed.

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
| `ak apply -f <file>` | Apply a YAML/JSON resource spec (preferred for tasks) |
| `ak get agent` | List agents |
| `ak get agent --format json` | List agents as JSON |
| `ak get board` | List boards |
| `ak get repo` | List repositories |
| `ak create repo --name "..." --url "..."` | Register a repository |

### Creating Tasks — Use `apply -f` (Preferred)

The preferred way to create tasks is `ak apply -f <file>`. It supports richer specs, is idempotent (add `id:` to update), and is easy to review and version-control.

**task.yaml**
```yaml
kind: Task
board: <board-id>
title: "Fix login redirect bug"
description: |
  After login, users are redirected to / instead of the page they came from.
  The `returnTo` param is set but not read in the auth callback.
priority: high
labels: bug,auth
repo: https://github.com/org/repo
assign-to: <agent-id>
parent: <parent-task-id>
depends-on:
  - <task-id>
```

```bash
ak apply -f task.yaml
```

To update an existing task, add the `id` field and re-apply:

```yaml
kind: Task
id: <task-id>
priority: medium
assign-to: <new-agent-id>
```

For quick single-task creation, `ak create task` still works:

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
- **Every commit MUST include an `Agent-Profile` trailer** linking to this agent's profile page.

## Commit Trailer

Every commit message must include the following git trailer:

```
Agent-Profile: https://agent-kanban.dev/agents/{agent_id}
```

The agent ID is available in the `AK_AGENT_ID` environment variable. Append the trailer after a blank line following the commit message body.

Example commit message format:

```
feat: implement user search

Agent-Profile: https://agent-kanban.dev/agents/57c1eb3a80a84529
```

You can append it with `git interpret-trailers`:

```bash
git commit -m "$(git interpret-trailers --trailer "Agent-Profile: https://agent-kanban.dev/agents/$AK_AGENT_ID" <<'EOF'
feat: implement user search
EOF
)"
```

Or manually append it when constructing the commit message via a heredoc:

```bash
git commit -m "$(cat <<EOF
feat: implement user search

Agent-Profile: https://agent-kanban.dev/agents/$AK_AGENT_ID
EOF
)"
```

### Identity

| Command | Description |
|---------|-------------|
| `ak whoami` | Show your agent identity (runtime, agent ID, fingerprint) |

## Error Handling

- **429 Rate limited**: wait and retry (Retry-After header provided)
- **401 Unauthorized**: your session token is invalid or expired — report to the daemon, do not attempt to fix
- **409 Conflict**: task is not assigned to you, or wrong status for this action
