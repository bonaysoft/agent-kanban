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

## Input

Parse the user's input:
- **Name** — version (e.g. "v1.4.0") or product name (e.g. "my-api")
- **Goals** — what to achieve (if not provided, ask)

## Phase 0: Detect Mode

Check if this is an **existing project** or a **new product**:

```bash
git remote -v 2>/dev/null    # has a repo? → existing project
ak get repo                  # registered repos
```

- **Existing project**: has git remote → skip to Phase 1
- **New product**: no repo → go to Phase 0.5 (Scaffold)

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

Register with agent-kanban:
```bash
ak create repo --name <name> --url <url>
```

The scaffold must contain enough structure for agents to start writing code immediately.

## Phase 1: Understand Current State

```bash
ak get board                   # existing boards
ak get agent                   # available agents
ak get repo                    # registered repos
git remote -v                  # repo URL (use this, never guess)
```

Read CLAUDE.md and recent git history to understand:
- What was shipped recently
- What patterns/conventions exist
- What the project architecture looks like

## Phase 2: Analyze Gaps

Use Explore agents to thoroughly scan the codebase for gaps related to the goals. Consider:
- Missing features vs stated goals
- Backend gaps (API, data model)
- CLI gaps (missing commands)
- Frontend gaps (if applicable, respect UI Principles in CLAUDE.md)
- Test coverage gaps

Present the analysis to the user and confirm scope before creating tasks.

## Phase 3: Create Board & Tasks

Use the existing board for the project. One project = one board.

```bash
ak get board                   # find the project board
# Only create a new board if this is a new product with no board yet
```

Create tasks with full specs. For each task:

1. **`--title`** — concise action phrase
2. **`--description`** — exhaustive spec including:
   - Files to create/modify
   - API endpoints, DB queries, UI components (concrete, not vague)
   - Patterns to follow from the existing codebase
3. **`--repo <id>`** — from `ak repo list`
4. **`--priority`** — urgent/high/medium/low
5. **`--labels`** — include version label (e.g. `v1.4.0`) plus category (backend, frontend, cli, etc.)
6. **`--depends-on`** — task IDs this depends on

Create tasks in dependency order so earlier task IDs can be referenced:
```bash
T1=$(ak create task --board $BOARD --title "..." --repo $REPO --priority high -o json | jq -r .id)
T2=$(ak create task --board $BOARD --title "..." --repo $REPO --depends-on $T1 -o json | jq -r .id)
```

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

## Patterns
- Follow existing project conventions (read CLAUDE.md)
```

Vague descriptions produce vague code. Be specific.

## Phase 4: Assign

Tasks should already be assigned via `--assign-to` on create. If not, use `ak update task <id>` or recreate.

Check existing agents. For a typical project you need:
- **fullstack-developer** or backend + frontend split

Create missing agents if needed:
```bash
ak create agent --template <template> --name "<Name>"
```

## Phase 5: Monitor & Merge

After assigning tasks, enter a monitoring loop until all tasks are done.

### Poll task status
```bash
ak get task --label <version>
```

Poll every 30-60 seconds. Track progress and report status changes to the user.

### When a task reaches `in_review` with a PR:
1. Check CI status: `gh pr checks <pr-number> --repo <owner>/<repo>`
2. If CI passes → merge: `gh pr merge <pr-number> --repo <owner>/<repo> --squash --delete-branch`
3. The daemon's PR Monitor will automatically complete the task when it detects the PR was merged — do NOT manually `ak task complete`.
4. If CI fails → check the failure, reject if needed: `ak task reject <task-id>`

### Handle merge conflicts:
If a PR can't merge cleanly (conflicts with previously merged PRs):
1. Checkout the branch: `git fetch origin && git checkout <branch> && git rebase origin/main`
2. Resolve conflicts manually
3. Force-push: `git push --force-with-lease origin <branch>`
4. Wait for CI to re-run, then merge

### Completion:
When all tasks are done, report the final summary to the user.

## Rules

- **Prefer text output** — only use `-o json | jq` when extracting fields into variables (e.g. task IDs for `--depends-on`). For display, use default text output.
- **Always get repo URL from `git remote -v`** — never guess
- **Discuss the plan with the user before creating tasks** — don't just start creating
- **Set depends-on at creation time** — don't leave deps for later
- **Space API calls** — avoid triggering rate limits during batch creation
- **Respect CLAUDE.md** — follow all project conventions and UI principles
- **Pre-install shared dependencies in scaffold** — avoid parallel install conflicts
- **Tasks touching the same files must be sequential** (depends-on)
- **Tasks touching different files can be parallel**
