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

## Identity

This is a leader workflow.

If `ak` says no leader identity exists for the current runtime, create one first:

```bash
ak identity create --username <username> [--name <name>]
```

The leader chooses its own username and optional full name.

## Unattended Execution Contract

Assume this workflow runs in an unattended environment: human not in the loop.

Ask the user only during the initial clarification and task preview phase, before task creation is confirmed. Once the user confirms the task, do not stop to ask for permission, confirmation, or next steps unless the user interrupts you. Continue through the full work cycle: create, assign, monitor, review, reject or complete, and report the outcome.

If execution hits a blocker after confirmation, use the available tools and repository context to resolve it. If the blocker cannot be resolved without external authorization or production mutation, fail fast with the exact blocker and the next required action instead of waiting in the middle of the workflow.

## Input

Parse the user's input:
- **What** — feature description or bug report (required)
- **Board** — which board (if not specified, use the first board)
- **Labels** — use existing board labels for version/category; create missing labels before task creation

## Phase 1: Create & Assign

### Step 1: Context

Before choosing or creating workers, read `references/runtime-delegation.md`. Before creating any worker, also read `references/agent-creation.md` and follow its Worker Profile Preview.

```bash
ak get board                   # pick the right board
ak get agent -o json           # available agents, load, runtime_available
ak get model --runtime <name>  # provider-reported models for a runtime
ak get repo                    # registered repos
```

If there's only one board, use it. Otherwise ask which board.

### Step 2: Investigate

Before creating the task, understand what's involved:
- Read CONTRIBUTING.md in the target repo to understand contribution requirements
- Read relevant source files to understand current implementation
- Identify which files need to change
- Check for existing related tasks: `ak get task --board <board-id>`

### Step 3: Confirm with User

Use `AskUserQuestion` to interactively resolve any uncertainties before creating the task. For each ambiguous point, present options for the user to choose from:

- **Scope unclear** — present 2-3 scope interpretations as options, each with a preview showing what files/changes are involved
- **Multiple approaches** — present implementation strategies as options with trade-off descriptions
- **Labels/agent/runtime/repo ambiguous** — present choices when there are multiple candidates
- **Dependencies uncertain** — present options about whether to depend on or parallelize with related tasks

#### Hard Stop: Agent Runtime Selection

Before creating workers or tasks, determine the worker runtime.

- If the user specified a runtime, assign only to a worker whose `runtime` matches it and whose `runtime_available` is `true`.
- If the user specified a runtime but that runtime is not schedulable, stop before worker or task creation and ask the user to choose an available runtime.
- If no matching available worker exists for the specified schedulable runtime, create a worker on that runtime before task creation using `references/agent-creation.md`.
- If the user did not specify runtime and multiple available runtimes are reasonable for the task, ask the user to choose the runtime before creating workers or tasks.
- Never silently default to the leader's own runtime.
- Before choosing a non-default model for a new worker, run `ak get model --runtime <runtime> -o json` and use a provider-reported model ID.

Keep iterating — each answer may reveal new questions. Only proceed to create when all points are resolved and the user has confirmed the final task spec.

If nothing is ambiguous (simple, clear-cut request), skip straight to the task preview below.

### Step 4: Preview & Create Task

Before creating, show the user the **exact task that will be created** using `AskUserQuestion`. Format the preview as:

```
📋 Task Preview

Title: <concise action phrase>
Board: <board-name>
Repo: <repo-name>
Agent: <agent-name>
Runtime: <agent-runtime>
Labels: <labels>
Depends on: <task-ids or "none">

## Goal
<one sentence>

## Files
- <file path> — <what changes>

## Spec
<concrete behavior: inputs, outputs, edge cases, error handling>

## Checks
- [ ] <verifiable condition — reviewer will check each one in Gate 2>

Examples by task type:
- API: "POST /api/items returns 201 with { id, name }"
- API: "empty name returns 400 with validation error"
- UI: "clicking Submit creates the item and navigates to detail page"
- UI: "empty form shows inline validation, submit button stays disabled"
- CLI: "ak get task --board xxx prints task table with status column"

---
Create this task? (y/n)
```

Everything from `## Goal` through `## Checks` is the exact text that will be passed to `--description`. The header fields above it (Title, Board, Agent, Runtime, etc.) are metadata for display only — do not include them in `--description`. The user must see the full description before it's sent to the agent.

Before running `ak create task`, verify:

- Selected agent is a worker.
- Selected agent has `runtime_available: true`.
- If the user specified runtime, selected agent runtime matches it.
- If the user specified runtime, that runtime is schedulable.
- If runtime was ambiguous, the user chose the runtime.
- Task Preview includes Runtime and Agent.
- `--assign-to` uses the selected agent ID.

**On confirmation**, create the task:

```bash
ak create task \
  --board <board-id> \
  --repo <repo-id> \
  --assign-to <agent-id> \
  --title "<concise action phrase>" \
  --description "<detailed spec>" \
  --labels "<comma-separated>"
```

**`--assign-to` is mandatory.** Always include it on create. Only assign to an agent whose `runtime_available` is `true`. If the right role only exists on an unavailable runtime, create a new worker with the required capability profile on an available runtime and assign to that worker. Use `references/agent-creation.md`; do not create workers from role/runtime alone.

**Dependencies**: If this task touches files that overlap with other in-flight tasks, add `--depends-on <task-id>`. Create all related tasks upfront with DAG dependencies — don't wait for one to finish before creating the next.

### Task Creation Best Practices

- Create one task for one reviewable outcome.
- Split by feature/module boundary and context overlap, not by human job title.
- Keep highly overlapping work in one task, even if it touches frontend, backend, CLI, schema, and tests.
- Split only when work is independently understandable, independently reviewable, and has low file/data/API context overlap.
- Make the title an action phrase, not a vague topic.
- Put implementation constraints and acceptance checks in `--description`; do not rely on chat context.
- Include concrete files, commands, endpoints, UI states, and error cases when known.
- Assign only to worker agents with `runtime_available: true`.
- Use `--depends-on` for real blockers or overlapping context. Parallel tasks must not fight over the same files, data model, or API contract.
- Create missing labels first with `ak create label --board <board-id> --name <name> --color <hex>`.

Report to user: task ID, title, assigned agent.

## Phase 2: Monitor & Review

### Step 5: Monitor

**Block on `ak wait` instead of writing polling loops.** Exit codes: 0 condition met, 2 task cancelled, 124 timeout.

```bash
ak wait task <task-id> --until in_review --timeout 1h
case $? in
  0)   ;;  # ready for review → Step 6
  2)   echo "task cancelled — abort" ; exit 1 ;;
  124) echo "timed out — investigate" ;;  # fall through to investigation
esac
```

Run `ak wait task --help` for the full flag list.

**On timeout (124) or if you suspect the agent is stuck, investigate immediately — don't just re-wait:**
1. Check daemon logs: `ak logs --lines 20`
2. Check if agent process is alive: `ps aux | grep "claude.*session"`
3. Check agent session log for what it's doing or where it's stuck
4. Check child processes: the agent may be stuck on a hook, install, or network call

### Step 6: Review PR

**Pre-check: CI status.** Before reviewing, verify CI has passed on the PR:
```bash
gh pr checks <pr-number> --repo <owner>/<repo>
```
If CI is pending or failed, reject immediately — worker must wait for CI to pass before submitting for review:
```bash
ak task reject <task-id> --reason "CI not green — wait for CI to pass before submitting for review"
```

Two gates — both must pass before merging. Reject as soon as either fails.

#### Gate 1: Code Review

Read the full PR diff and review against the task spec:
```bash
gh pr view <pr-number> --repo <owner>/<repo> --json title,body,additions,deletions,changedFiles
gh pr diff <pr-number> --repo <owner>/<repo>
```

Check:
- Does the implementation match the task spec?
- Code quality — logic errors, bad abstractions, security issues
- Boundary awareness — CLI user-facing output vs internal logging, public API vs private
- Missing or broken test updates
- Dropped functionality (lost stack traces, removed useful info, etc.)

**Fails → reject immediately**, don't proceed to Gate 2.

#### Gate 2: Functional Acceptance

Passing tests, CI, and code review is not completion. Validate the feature from the product/user perspective before accepting it.

Re-read the target repo's CONTRIBUTING.md before testing — don't rely on memory from Step 2.
- Walk through every item in the task's `## Checks` section — each must pass
- Visit the preview/staging deployment and verify end-to-end
- Check for regressions in related features
- Run any project-specific verification steps defined in CONTRIBUTING.md
- If an acceptance specialist is attached to the reviewing agent, use it for product-level E2E or manual acceptance checks, then independently judge whether its findings are sufficient.

##### Non-Production Verification Blockers

Preview, staging, local dev, and other non-production environments are agent-operable verification environments.

If functional acceptance is blocked in a non-production environment by missing credentials, stale migrations, missing feature/license data, bad seed data, authorization setup, or corrupted test state, recover the environment and continue verification. Allowed recovery actions include resetting test passwords, applying migrations, creating test users, seeding test data, enabling test-only feature/license bindings, recreating broken non-production state, and rerunning deployment or CI checks.

No non-production blocker permits skipping the task's functional verification or regression checks. Exercise the implemented feature end-to-end before merge, not only an auth gate, paywall, error state, or empty shell around it.

Production is the exception: do not mutate production credentials, customer data, license state, or other production resources unless the user explicitly authorizes that specific action.

**Fails → reject with specific repro steps.**

#### Gate 3: Agent Notes Review

Read task notes before merging:

```bash
ak get note --task <task-id>
```

Check:
- The worker summarized what was done.
- Whether the worker proposed any durable process or principle change for its agent profile.
- Any proposal includes the reason, exact fields to change, and complete candidate `Agent` YAML using the same `metadata.name` username as the current agent.

If the completion summary is missing or unclear, reject and ask the worker to add it.

If no proposal is present, continue. If a proposal is present, review it using `references/runtime-delegation.md`. Apply it only when the proposal is durable, role-appropriate, and not task-specific.

### Step 7: Decide — act immediately, do not ask the user

**Any gate fails → Reject.** List all issues in the reason.
```bash
ak task reject <task-id> --reason "<all issues, specific and actionable>"
```
After reject, go back to Step 5 and keep monitoring.

**Both gates pass → Post verification comment, then merge.**

Post a verification comment on the PR with evidence before merging:
```bash
gh pr comment <pr-number> --repo <owner>/<repo> --body "$(cat <<'EOF'
## Verification

### Functional Test
- Visited: <staging/preview URL tested>
- Golden path: <what was tested and result>
- Edge cases: <what was tested and result>

### Test Suite
<test commands run and pass/fail summary>

### Conclusion
All checks pass — merging.
EOF
)"
```

If the PR has merge conflicts, reject instead of merging — the worker agent will rebase, fix, and resubmit:
```bash
ak task reject <task-id> --reason "merge conflicts with main — rebase and resubmit"
```

Then merge:
```bash
gh pr merge <pr-number> --repo <owner>/<repo> --squash --delete-branch
```
The daemon's PR Monitor will mark the task done — do NOT manually `ak task complete`.

#### Cleanup after merge
Remove local review artifacts from the repo root:
```bash
rm -rf /tmp/ak-review-* playwright-report/ test-results/
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

### AK command or product issue
If the blocker appears to be an `ak` bug, missing capability, confusing UX, or documentation gap, file an issue in the official repo after collecting a minimal reproduction:

```bash
gh issue create \
  --repo saltbo/agent-kanban \
  --title "ak: <short problem summary>" \
  --body "$(cat <<'EOF'
## Summary
<what failed or what capability is missing>

## Command
ak <command and flags>

## Expected
<what should have happened>

## Actual
<exact error text or observed behavior>

## Context
- ak version:
- OS:
- Runtime:
- Auth type: user | machine | agent
- Board/task/repo IDs, if relevant:

## Reproduction
1. <step>
2. <step>
EOF
)"
```

Never include API keys, session tokens, private keys, `.env` contents, or private repository data. If `gh` is unavailable, open `https://github.com/saltbo/agent-kanban/issues/new` and paste the same content.

## Rules

- **Workflow completion is mandatory** — once this skill is invoked, the full lifecycle (create → assign → monitor → review → merge/reject) MUST run to completion. If you are interrupted mid-workflow (user asks a side question, chat drifts to another topic, tool fails, etc.), handle the interruption and then **immediately resume the workflow from where you left off**. Never ask "should I continue monitoring?" or "do you want me to keep going?" — the answer is always yes. The only way to exit the workflow early is if the user explicitly says to stop, cancel, or abort.
- **Follow CONTRIBUTING.md** — read the target repo's CONTRIBUTING.md before creating tasks; check PR compliance during review
- **Investigate before creating** — read the code first, don't create vague tasks
- **One coherent outcome per invocation** — if the user describes multiple unrelated or low-overlap outcomes, create one and suggest splitting the rest
- **Detailed descriptions** — agents are autonomous, the description is their only input
- **Check for duplicates** — look at existing tasks before creating
- **Review = act** — reject or merge based on your review, don't ask the user for permission
- **Think about dependencies** — tasks with overlapping files, data model, API contract, or context must use `--depends-on` or be merged
- **Always `--assign-to` on create** — never create a task without assigning an agent
- **Close PR before cancel** — never cancel a task without closing its PR first
- **Don't sleep-poll blindly** — if monitoring takes too long, investigate daemon logs and agent processes immediately
