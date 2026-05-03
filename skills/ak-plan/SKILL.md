---
name: ak-plan
description: |
  Plan and execute a project — either a new version of an existing project, or a
  brand new product from scratch. Analyzes gaps, creates board with tasks and
  dependencies, assigns to agents. Use when asked to "plan a version", "plan v1.4",
  "build a product", "create a project", "规划版本", or "/ak-plan <version> <goals>".
argument-hint: "<version-or-name> [goals]"
disable-model-invocation: true
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Grep
  - Glob
  - Agent
  - AskUserQuestion
---

# ak-plan — Project Planning

Plan and create a board with tasks — for a new version release or a new product from scratch.

## Identity

This is a leader workflow.

If `ak` says no leader identity exists for the current runtime, create one first:

```bash
ak identity create --username <username> [--name <name>]
```

The leader chooses its own username and optional full name.

## Input

Parse the user's input:
- **Name** — version (e.g. "v1.4.0") or product name (e.g. "my-api")
- **Goals** — what to achieve (if not provided, ask)

## Phase 0: Detect Mode

Check if this is an **existing project** or a **new product**:

```bash
git remote -v 2>/dev/null    # has a remote? → existing project
ak get repo                  # registered repos
```

Three possible states:

- **Existing project with remote** → skip to Phase 1
- **New product (no git init yet)** → go to Phase 0.5 (Scaffold)
- **Local-only project (git init done, no remote)** → STOP. A registered repo must have a real remote (`https://…` or `git@…`). Tell the user one of:
  1. Push the project to GitHub first: `gh repo create <owner>/<name> --source . --push`
  2. Or: ask them for the intended remote URL before proceeding.

  **Never invent a URL** (no `file://`, no local paths, no placeholders). The agent-kanban server will reject non-http(s)/ssh URLs with 400, and even if it didn't, the daemon cannot clone local paths.

## Phase 0.5: Scaffold (new products only)

```bash
# Create and clone repo (NEVER inside an existing git repo)
gh repo create <owner>/<name> --public --description "<one-liner>" --clone
cd <repo-dir>

# Initialize project — use framework CLIs, install ALL dependencies upfront
# Ask user for tech stack if not specified

# Create config files, entry point, DB schema, .gitignore
# Commit and push
git add -A && git commit -m "feat: project scaffold" && git push -u origin main
```

Register with agent-kanban (URL MUST come from `git remote get-url origin` — never hand-crafted):
```bash
ak create repo --name <name> --url "$(git remote get-url origin)"
```

The scaffold must contain enough structure for agents to start writing code immediately.

## Phase 1: Understand Current State

```bash
ak get board                   # existing boards
ak get agent -o json           # available agents, load, runtime_available
ak get repo                    # registered repos
git remote -v                  # repo URL (use this, never guess)
```

Read CLAUDE.md, CONTRIBUTING.md, and recent git history to understand:
- What was shipped recently
- What patterns/conventions exist
- What the project architecture looks like
- Contribution requirements (branch strategy, commit format, code style, test expectations)

## Phase 2: Analyze Gaps

Use Explore agents to thoroughly scan the codebase for gaps related to the goals. Consider:
- Missing features vs stated goals
- Backend gaps (API, data model)
- CLI gaps (missing commands)
- Frontend gaps (if applicable, respect UI Principles in CLAUDE.md)
- Test coverage gaps

Use `AskUserQuestion` to interactively confirm the plan with the user. For each ambiguous point, present options:

- **Scope** — which gaps to address in this version vs defer to later
- **Priority/ordering** — which tasks are critical path vs nice-to-have
- **Approach** — when multiple implementation strategies exist, present them with trade-off descriptions
- **Task granularity** — whether to split a large piece into subtasks or keep it as one

Keep iterating until all uncertainties are resolved.

Before creating any tasks, show the user a **task summary table** using `AskUserQuestion`:

```
📋 Task Plan Preview

| # | Title | Repo | Priority | Labels | Depends on | Agent |
|---|-------|------|----------|--------|------------|-------|
| 1 | <title> | <repo> | high | backend | — | <agent> |
| 2 | <title> | <repo> | medium | frontend | #1 | <agent> |
| ...

Per-task description summary:

### Task 1: <title>
Goal: <one sentence>
Files: <file list>
Spec: <key points — not the full description, but enough to judge scope>

### Task 2: <title>
...

---
Create all tasks? (y/n)
```

The user must confirm before any `ak create task` calls are made. If the user requests changes, adjust and re-preview.

## Phase 3: Create Board, Workers & Tasks

Use the existing board for the project. One project = one board.

```bash
ak get board                   # find the project board
# Only create a new board if this is a new product with no board yet
```

Before creating tasks, choose or create the workers that will own them. Read `references/runtime-delegation.md`.

Check existing agents. For a typical project you need:
- **fullstack-developer** or backend + frontend split

Only assign work to agents whose `runtime_available` is `true`. If the best role exists only on an unavailable runtime, create a new worker with the same role, soul, skills, and handoff settings on an available runtime.

Create missing agents before task creation:
```yaml
kind: Agent
metadata:
  name: <human-username>
  annotations:
    agent-kanban.dev/display-name: "<Human Name>"
spec:
  runtime: <available-runtime>
  role: "<role>"
  bio: "<durable responsibility>"
  skills:
    - <source>@<skill>
  subagents:
    - <worker-agent-id>
```

The leader must generate the Agent YAML from the project context and apply it with `ak apply -f <file>`. Do not use role templates. After creation, run `ak get agent -o json` and confirm the new worker is visible and `runtime_available: true` before assigning tasks.

Create tasks with full specs. For each task:

1. **`--title`** — concise action phrase
2. **`--description`** — exhaustive spec including:
   - Files to create/modify
   - API endpoints, DB queries, UI components (concrete, not vague)
   - Patterns to follow from the existing codebase
3. **`--repo <id>`** — from `ak repo list`
4. **`--priority`** — urgent/high/medium/low
5. **`--labels`** — include version label (e.g. `v1.4.0`) plus category (backend, frontend, cli, etc.)
6. **`--assign-to <agent-id>`** — worker chosen before task creation
7. **`--depends-on`** — task IDs this depends on

Create tasks in dependency order so earlier task IDs can be referenced:
```bash
T1=$(ak create task --board $BOARD --title "..." --repo $REPO --assign-to $AGENT --priority high -o json | jq -r .id)
T2=$(ak create task --board $BOARD --title "..." --repo $REPO --assign-to $AGENT --depends-on $T1 -o json | jq -r .id)
```

### Task Creation Best Practices

- Create one task for one reviewable outcome. Split unrelated backend, frontend, CLI, and infra work.
- Make each task independently claimable: no hidden chat context, no "continue from above" descriptions.
- Put the exact files, APIs, commands, UI states, and acceptance checks in `--description`.
- Assign every task at creation with `--assign-to`.
- Use `--depends-on` for real blockers or overlapping files. Tasks touching the same files should be sequential.
- Keep parallel tasks independent by file ownership and data model boundary.
- Use stable labels: version plus area, such as `v1.4.0,backend` or `v1.4.0,cli`.

### Task Description Quality

Agents are autonomous — the description is their only input. A good description:

```
## Goal
One sentence: what this task produces.

## Files
- src/foo.ts — API route handlers
- src/bar.ts — data access layer

## Spec
POST /api/items — create item
  Request: { "name": string }
  Response: 201 { "id": 1, "name": "..." }
  Empty name → 400 validation error

## Checks
- [ ] POST /api/items returns 201 with { id, name }
- [ ] Empty name returns 400 with validation error
- [ ] New item appears on the list page without refresh
- [ ] Empty state shows "No items yet" placeholder
```

Vague descriptions produce vague code. Be specific.

## Phase 4: Monitor & Merge

**Block on `ak wait board` instead of writing polling loops.** It streams tasks one at a time as they reach the filter status. Exit codes: 0 condition met, 2 task cancelled, 124 timeout.

### React to PRs as workers push them
```bash
# Stream in_review tasks one at a time, handle each, then wait for the next
while ak wait board <board-id> --filter in_review --timeout 1h; do
  # Latest in_review task is printed — review its PR, merge or reject
  :
done

# Or wait until the entire board converges (0 = infinite)
ak wait board <board-id> --until all-done --timeout 0
```

Run `ak wait board --help` for the full flag list.

### When a task reaches `in_review` with a PR:

**Pre-check: CI status.** Before reviewing, verify CI has passed on the PR:
```bash
gh pr checks <pr-number> --repo <owner>/<repo>
```
If CI is pending or failed, reject immediately — worker must wait for CI to pass before submitting:
```bash
ak task reject <task-id> --reason "CI not green — wait for CI to pass before submitting for review"
```

Two gates — both must pass before merging. Reject as soon as either fails.

**Gate 1: Code Review**

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

**Gate 2: Functional Acceptance**
- Re-read the target repo's CONTRIBUTING.md before testing — don't rely on memory from Phase 1
- Walk through every item in the task's `## Checks` section — each must pass
- Visit preview/staging deployment and verify end-to-end
- Check for regressions in related features
- **Fails → reject with specific repro steps**

**Either gate fails → Reject.** List all issues in the reason.
```bash
ak task reject <task-id> --reason "<all issues, specific and actionable>"
```

**Both gates pass → Post verification comment, then merge.**

Post evidence on the PR before merging:
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
The daemon's PR Monitor will automatically complete the task — do NOT manually `ak task complete`.

#### Cleanup after merge
Remove local review artifacts from the repo root:
```bash
rm -rf /tmp/ak-review-* playwright-report/ test-results/
```

### Completion:
When all tasks are done, report the final summary to the user.

## AK Command or Product Issues

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

- **Workflow completion is mandatory** — once this skill is invoked, the full lifecycle (plan → create → assign → monitor → review → merge all) MUST run to completion. If you are interrupted mid-workflow (user asks a side question, chat drifts to another topic, tool fails, etc.), handle the interruption and then **immediately resume the workflow from where you left off**. Never ask "should I continue monitoring?" or "do you want me to keep going?" — the answer is always yes. The only way to exit the workflow early is if the user explicitly says to stop, cancel, or abort.
- **Follow CONTRIBUTING.md** — read the target repo's CONTRIBUTING.md before creating tasks; check PR compliance during review
- **Prefer text output** — only use `-o json | jq` when extracting fields into variables (e.g. task IDs for `--depends-on`). For display, use default text output.
- **Always get repo URL from `git remote get-url origin`** — never guess, never improvise. If there is no remote, stop and ask the user to push the repo first (see Phase 0). `file://`, local paths, and placeholder URLs will be rejected by the server with 400.
- **Discuss the plan with the user before creating tasks** — don't just start creating
- **Set depends-on at creation time** — don't leave deps for later
- **Space API calls** — avoid triggering rate limits during batch creation
- **Respect CLAUDE.md** — follow all project conventions and UI principles
- **Pre-install shared dependencies in scaffold** — avoid parallel install conflicts
- **Tasks touching the same files must be sequential** (depends-on)
- **Tasks touching different files can be parallel**
