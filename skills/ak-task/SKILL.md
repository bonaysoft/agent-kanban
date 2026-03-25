---
name: ak-task
description: |
  Full task lifecycle: create → assign → monitor → review → reject/complete.
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

# ak-task — Task Lifecycle

Create a task, assign it, then monitor → review → reject/complete.

## Input

Parse the user's input:
- **What** — feature description or bug report (required)
- **Board** — which board (if not specified, use the first board)
- **Priority** — infer from context, default to medium

## Phase 1: Create & Assign

### Step 1: Context

```bash
ak board list                  # pick the right board
ak agent list                  # available agents
ak repo list                   # registered repos
```

If there's only one board, use it. Otherwise ask which board.

### Step 2: Investigate

Before creating the task, understand what's involved:
- Read relevant source files to understand current implementation
- Identify which files need to change
- Check for existing related tasks: `ak task list`

### Step 3: Create Task

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

**Dependencies**: If this task touches files that overlap with other in-flight tasks, use `--depends-on <task-id>` to serialize execution. Think about conflicts proactively. When creating multiple related tasks, create them all upfront with DAG dependencies — don't wait for one to finish before creating the next.

### Step 4: Assign

**Prefer `--assign-to` on create** — this works even for blocked tasks:
```bash
ak task create ... --assign-to <agent-id>
```

If the task was already created without `--assign-to`, use:
```bash
ak task assign <task-id> --agent <agent-id>
```
Note: `ak task assign` rejects blocked tasks (409). If that happens, use `--assign-to` on create next time, or PATCH the API directly.

Report to user: task ID, title, assigned agent.

## Phase 2: Monitor & Review

### Step 5: Monitor

Poll until the task reaches `in_review`:
```bash
ak task list --format json | jq '.[] | select(.id == "<task-id>") | {status, pr_url}'
```

Use `--format json` here because you need to extract fields programmatically.

Poll every 60–120 seconds. When status becomes `in_review` and `pr_url` is set, proceed to Step 6.

### Step 6: Review PR

Read the full PR diff and review against the task spec:
```bash
gh pr view <pr-number> --repo <owner/repo> --json title,body,additions,deletions,changedFiles
gh pr diff <pr-number> --repo <owner/repo>
```

Check for:
- Does the implementation match the task spec?
- Code quality — logic errors, bad abstractions, security issues
- Boundary awareness — CLI user-facing output vs internal logging, public API vs private
- Missing or broken test updates
- Dropped functionality (lost stack traces, removed useful info, etc.)

### Step 7: Decide — act immediately, do not ask the user

**Issues found → Reject.** List all issues in the reason.
```bash
ak task reject <task-id> --reason "<all issues, specific and actionable>"
```
After reject, go back to Step 5 and keep monitoring.

**All good → Merge the PR, daemon auto-completes the task.**
```bash
gh pr checks <pr-number> --repo <owner>/<repo>
gh pr merge <pr-number> --repo <owner>/<repo> --squash --delete-branch
```
The daemon's PR Monitor will mark the task done — do NOT manually `ak task complete`.

If a PR has merge conflicts, rebase it:
```bash
git fetch origin && git checkout <branch> && git rebase origin/master
git push --force-with-lease origin <branch>
```

## Phase 3: Exception Handling

### Stuck rejected task
If a rejected task stays `in_progress` without being picked up (daemon may not support reject-resume yet):
1. Cancel: `ak task cancel <task-id>`
2. Recreate with original spec + review feedback + reference the existing PR branch so the agent continues, not restarts
3. Assign to the same agent

### CI failure
Investigate the failure. If it's a source bug, reject with details. If it's flaky CI, re-trigger.

## Rules

- **Investigate before creating** — read the code first, don't create vague tasks
- **One task per invocation** — if the user describes multiple things, create one and suggest splitting
- **Detailed descriptions** — agents are autonomous, the description is their only input
- **Check for duplicates** — look at existing tasks before creating
- **Review = act** — reject or merge based on your review, don't ask the user for permission
- **Think about dependencies** — tasks touching shared files must use `--depends-on`
