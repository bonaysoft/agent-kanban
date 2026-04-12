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
ak get board                   # pick the right board
ak get agent                   # available agents
ak get repo                    # registered repos
```

If there's only one board, use it. Otherwise ask which board.

### Step 2: Investigate

Before creating the task, understand what's involved:
- Read CONTRIBUTING.md in the target repo to understand contribution requirements
- Read relevant source files to understand current implementation
- Identify which files need to change
- Check for existing related tasks: `ak get task`

### Step 3: Confirm with User

Use `AskUserQuestion` to interactively resolve any uncertainties before creating the task. For each ambiguous point, present options for the user to choose from:

- **Scope unclear** — present 2-3 scope interpretations as options, each with a preview showing what files/changes are involved
- **Multiple approaches** — present implementation strategies as options with trade-off descriptions
- **Priority/agent/repo ambiguous** — present choices when there are multiple candidates
- **Dependencies uncertain** — present options about whether to depend on or parallelize with related tasks

Keep iterating — each answer may reveal new questions. Only proceed to create when all points are resolved and the user has confirmed the final task spec.

If nothing is ambiguous (simple, clear-cut request), skip straight to presenting a summary and asking for a single confirmation.

### Step 4: Create Task

Write a detailed description with:
- Goal (one sentence)
- Files to modify
- Specific behavior/spec
- Patterns to follow

```bash
ak create task \
  --board <board-id> \
  --repo <repo-id> \
  --assign-to <agent-id> \
  --title "<concise action phrase>" \
  --description "<detailed spec>" \
  --priority <priority> \
  --labels "<comma-separated>"
```

**`--assign-to` is mandatory.** Always include it on create.

**Dependencies**: If this task touches files that overlap with other in-flight tasks, add `--depends-on <task-id>`. Create all related tasks upfront with DAG dependencies — don't wait for one to finish before creating the next.

Report to user: task ID, title, assigned agent.

## Phase 2: Monitor & Review

### Step 6: Monitor

**Block on `ak wait` instead of writing polling loops.** Exit codes: 0 condition met, 2 task cancelled, 124 timeout.

```bash
ak wait task <task-id> --until in_review --timeout 1h
case $? in
  0)   ;;  # ready for review → Step 7
  2)   echo "task cancelled — abort" ; exit 1 ;;
  124) echo "timed out — investigate" ;;  # fall through to investigation
esac
```

Run `ak wait task --help` for the full flag list.

**On timeout (124) or if you suspect the agent is stuck, investigate immediately — don't just re-wait:**
1. Check daemon logs: `ak logs --no-follow --lines 20`
2. Check if agent process is alive: `ps aux | grep "claude.*session"`
3. Check agent session log for what it's doing or where it's stuck
4. Check child processes: the agent may be stuck on a hook, install, or network call

### Step 7: Review PR

Read the full PR diff and review against the task spec:
```bash
gh pr view <pr-number> --repo <owner/repo> --json title,body,additions,deletions,changedFiles
gh pr diff <pr-number> --repo <owner/repo>
```

Review in two parts:

**Code review** — read the diff and check:
- Does the implementation match the task spec?
- Code quality — logic errors, bad abstractions, security issues
- Boundary awareness — CLI user-facing output vs internal logging, public API vs private
- Missing or broken test updates
- Dropped functionality (lost stack traces, removed useful info, etc.)

**CONTRIBUTING.md review process** — follow whatever review steps the target repo's CONTRIBUTING.md defines. This may include visiting a preview/staging environment for functional verification, running specific checks, or other project-specific review procedures.

### Step 8: Decide — act immediately, do not ask the user

**Issues found → Reject.** List all issues in the reason.
```bash
ak task reject <task-id> --reason "<all issues, specific and actionable>"
```
After reject, go back to Step 5 and keep monitoring.

**All good → Wait for CI, merge the PR, daemon auto-completes the task.**
```bash
ak wait pr <pr-number> --timeout 10m && \
  gh pr merge <pr-number> --repo <owner>/<repo> --squash --delete-branch
```
The daemon's PR Monitor will mark the task done — do NOT manually `ak task complete`.

If a PR has merge conflicts, rebase it:
```bash
git fetch origin && git checkout <branch> && git rebase origin/main
git push --force-with-lease origin <branch>
```

## Phase 3: Exception Handling

### Removing a task in todo
Tasks in `todo` status cannot be cancelled — delete them directly:
```bash
ak delete task <task-id>
```

### Canceling an active task
For tasks in `in_progress` or `in_review`: **always close the PR first**, then cancel. Closing the PR without canceling is fine — PR Monitor will auto-cancel. But canceling without closing the PR leaves orphaned PRs.
```bash
gh pr close <pr-number> --repo <owner>/<repo> --delete-branch
ak task cancel <task-id>
```

### Stuck rejected task
If a rejected task stays `in_progress` without being picked up:
1. Check daemon logs — is it detecting the rejection?
2. If daemon is down or not tracking, close the PR, cancel, recreate with original spec + review feedback + reference the existing PR branch
3. Always use `--assign-to` on recreate

### CI failure
Investigate the failure. If it's a source bug, reject with details. If it's flaky CI, re-trigger.

## Rules

- **Follow CONTRIBUTING.md** — read the target repo's CONTRIBUTING.md before creating tasks; check PR compliance during review
- **Investigate before creating** — read the code first, don't create vague tasks
- **One task per invocation** — if the user describes multiple things, create one and suggest splitting
- **Detailed descriptions** — agents are autonomous, the description is their only input
- **Check for duplicates** — look at existing tasks before creating
- **Review = act** — reject or merge based on your review, don't ask the user for permission
- **Think about dependencies** — tasks touching shared files must use `--depends-on`
- **Always `--assign-to` on create** — never create a task without assigning an agent
- **Close PR before cancel** — never cancel a task without closing its PR first
- **Don't sleep-poll blindly** — if monitoring takes too long, investigate daemon logs and agent processes immediately
