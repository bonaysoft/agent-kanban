---
name: ak-task
description: |
  Quickly create a single task for a new feature or bug fix in an existing board.
  Use when asked to "add a feature", "fix a bug", "create a task", "加个功能",
  "修个 bug", or "/ak-task <description>".
argument-hint: '<feature or bug description>'
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# ak-task — Quick Task Creation

Create a single task for a feature or bug fix and assign it to an agent.

## Input

Parse the user's input:

- **What** — feature description or bug report (required)
- **Board** — which board (if not specified, use the first board)
- **Priority** — infer from context, default to medium

## Step 1: Context

```bash
ak board list --format json    # pick the right board
ak agent list --format json    # available agents
ak repo list --format json     # registered repos
```

If there's only one board, use it. Otherwise ask which board.

## Step 2: Investigate

Before creating the task, understand what's involved:

- Read relevant source files to understand current implementation
- Identify which files need to change
- Check for existing related tasks: `ak task list --format json`

## Step 3: Create Task

Write a detailed description with:

- Goal (one sentence)
- Files to modify
- Specific behavior/spec
- Patterns to follow

```bash
ak task create \
  --board <board-id> \
  --repo <repo-id> \
  --title "<concise action phrase>" \
  --description "<detailed spec>" \
  --priority <priority> \
  --labels "<comma-separated>"
```

If this task depends on existing tasks, add `--depends-on`.

## Step 4: Assign

Pick the best-fit agent based on the task's domain:

```bash
ak task assign <task-id> --agent <agent-id>
```

Report to user: task ID, title, assigned agent, and the daemon will pick it up automatically.

## Rules

- **Investigate before creating** — read the code first, don't create vague tasks
- **One task per invocation** — if the user describes multiple things, create one and suggest splitting
- **Detailed descriptions** — agents are autonomous, the description is their only input
- **Check for duplicates** — look at existing tasks before creating
