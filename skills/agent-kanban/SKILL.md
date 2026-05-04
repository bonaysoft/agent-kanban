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
3. **Local test** → run the project's test suite and type check before pushing. Fix all failures locally. Skip only if tests cannot run locally.
4. **PR** → push branch, `gh pr create`
5. **Wait for CI** → `gh pr checks <pr-number> --watch` — fix failures, push, re-check until green
6. **Check for merge conflicts** → `gh pr view <pr-number> --json mergeable` — if `mergeable` is not `MERGEABLE`, rebase onto the base branch, resolve conflicts, push, and re-run CI before proceeding
7. **Completion note** → before review, post a final note that starts with `Completion Summary:` and includes `Profile Decision:`; include a profile proposal only if the task revealed a durable process or principle issue → `ak create note --task <id> "..."`
8. **Submit for review** only after CI passes, PR is conflict-free, and the completion note is posted → `ak task review <id> --pr-url <url>`

## Agent Profile Change Candidates

Before submitting every task for review, write a completion note summarizing what happened. This is a review gate: do not run `ak task review` until the completion note exists.

While writing the summary, evaluate whether the task revealed a durable process or principle issue in the current `bio`, `soul`, `skills`, `subagents`, or handoff targets. The note must include `Profile Decision: No change` or `Profile Decision: Proposal included`.

Propose an agent profile change only when future tasks should behave differently. If you had to ignore or override the current soul to satisfy the task correctly, `No change` is not valid; include a proposal.

Good reasons:

- The current soul made you choose the wrong workflow or review bar.
- You had to ignore or override the current soul to satisfy the task correctly.
- A required installable skill was missing for this kind of work.
- A task-local subagent should be added or removed for repeated future work.
- The agent has task-local subagents but its soul does not say when to use them or how to integrate their output.
- The role/bio is misleading for the work the leader assigns to this agent.

Do not propose profile changes for:

- One-off task facts, project details, or temporary user preferences.
- Source-code bugs fixed by the current task.
- Missing context that belongs in the task description.

Workers do not update agent profiles directly. When a durable profile change is needed, include a proposal in the completion note with:

- The reason the current profile caused incorrect or inefficient behavior.
- The exact fields that should change.
- A complete candidate `Agent` YAML using the same `metadata.name` username.
- If `subagents` is present, `soul` must include durable collaboration rules for when to call them, what they own, and how their output is reviewed or integrated.

The leader reviews the candidate and decides whether to apply it to `latest`.

Use this shape when a proposal is needed:

Completion Summary:
- <what changed>
- <tests/checks run>
- <handoff details>

Profile Decision: Proposal included

Agent Profile Proposal:
Reason: <durable process or principle issue>
Fields: <exact fields to change>

```yaml
kind: Agent
metadata:
  name: <same-username>
  annotations:
    agent-kanban.dev/nickname: "<human nickname>"
spec:
  bio: "<updated bio if needed>"
  soul: |
    <updated durable behavior policy and decision rules>
```

## Commands

### Task Lifecycle

| Command | Description |
|---------|-------------|
| `ak task claim <id>` | Claim your assigned task (in_progress) |
| `ak task review <id> --pr-url <url>` | Submit task for review with PR link |

### Resource CRUD (kubectl-style)

| Command | Description |
|---------|-------------|
| `ak get task <id>` | View a single task by ID |
| `ak get task --board <id>` | List tasks for a board (`--board` required). Optional filters: `--status`, `--label`, `--repo` |
| `ak get note --task <id>` | View progress logs for a task |
| `ak create note --task <id> "message"` | Add a progress log entry |
| `ak apply -f <file>` | Apply a YAML/JSON resource spec (preferred for tasks) |
| `ak get agent` | List agents, including load and unavailable runtime markers |
| `ak get agent -o json` | List agents as JSON, including `runtime_available`, `queued_task_count`, and `active_task_count` |
| `ak describe agent "$AK_AGENT_ID"` | Inspect your current agent profile |
| `ak get board` | List boards |
| `ak get repo` | List repositories |
| `ak create repo --name "..." --url "..."` | Register a repository |

### Creating Tasks — Use `apply -f` (Preferred)

The preferred way to create tasks is `ak apply -f <file>`. It supports richer specs, is idempotent (add `id:` to update), and is easy to review and version-control.

**task.yaml**
```yaml
kind: Task
spec:
  boardId: <board-id>
  title: "Fix login redirect bug"
  description: |
    After login, users are redirected to / instead of the page they came from.
    The `returnTo` param is set but not read in the auth callback.
  priority: high
  labels: [bug, auth]
  repo: https://github.com/org/repo
  assignTo: <agent-id>
  createdFrom: <parent-task-id>
  dependsOn:
    - <task-id>
```

```bash
ak apply -f task.yaml
```

To update an existing task, add the `id` field inside `spec` and re-apply:

```yaml
kind: Task
spec:
  id: <task-id>
  priority: medium
  assignTo: <new-agent-id>
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

- Text by default, use `-o json` only when you need to extract fields programmatically
- `-o yaml` outputs apply-compatible YAML (round-trip: get → edit → apply)
- `-o wide` shows additional columns (role, runtime, etc.)

## Rules

- **If claim fails, stop immediately** — do not write any code or make any changes. Report the error and wait.
- **Never call `task complete`** — only humans complete tasks.
- **Test before pushing** — run the project's test suite and type check locally. All tests must pass before `git push`. Skip only if tests cannot run locally. Do not rely on CI to catch failures you could have caught locally.
- **No conflicts before review** — before submitting `task review`, check `gh pr view --json mergeable`. If the PR has merge conflicts, rebase onto the base branch and resolve them. Never submit a conflicted PR for review.
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
