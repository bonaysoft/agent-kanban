---
name: ak-task
description: |
  Quickly create a single task for a new feature or bug fix in an existing board.
  Use when asked to "add a feature", "fix a bug", "create a task", "加个功能",
  "修个 bug", or "/ak-task <description>".
argument-hint: "<feature or bug description>"
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
ak board list                  # pick the right board
ak agent list                  # available agents
ak repo list                   # registered repos
```

If there's only one board, use it. Otherwise ask which board.

## Step 2: Investigate

Before creating the task, understand what's involved:
- Read relevant source files to understand current implementation
- Identify which files need to change
- Check for existing related tasks: `ak task list`

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

Report to user: task ID, title, assigned agent.

## Step 5: Monitor & Merge

After assigning, monitor the task until completion.

```bash
ak task list --label <label>    # poll status
```

Poll every 30-60 seconds. When the task reaches `in_review` with a PR:
1. Check CI: `gh pr checks <pr-number> --repo <owner>/<repo>`
2. If CI passes → merge: `gh pr merge <pr-number> --repo <owner>/<repo> --squash --delete-branch`
3. Complete: `ak task complete <task-id> --result "PR #<n> merged: <summary>"`
4. If CI fails → investigate, reject if needed: `ak task reject <task-id>`

If a PR has merge conflicts, rebase it:
```bash
git fetch origin && git checkout <branch> && git rebase origin/master
git push --force-with-lease origin <branch>
```

## Rules

- **Investigate before creating** — read the code first, don't create vague tasks
- **One task per invocation** — if the user describes multiple things, create one and suggest splitting
- **Detailed descriptions** — agents are autonomous, the description is their only input
- **Check for duplicates** — look at existing tasks before creating
