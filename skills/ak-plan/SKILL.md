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
ak repo list                 # registered repos
```

- **Existing project**: has git remote → skip to Phase 1
- **New product**: no repo → go to Phase 0.5 (Scaffold)

## Phase 0.5: Scaffold (new products only)

```bash
# Create and clone repo (NEVER inside an existing git repo)
gh repo create <owner>/<name> --public --description "<one-liner>" --clone
cd <repo-dir>

# Initialize project — use framework CLIs, install ALL dependencies upfront
# Default stack: Hono + Cloudflare Workers + D1 (unless user specifies otherwise)

# Create config files, entry point, DB schema, .gitignore
# Commit and push
git add -A && git commit -m "feat: project scaffold" && git push -u origin master
```

Register with agent-kanban:
```bash
ak repo add --name <name> --url <url>
```

The scaffold must contain enough structure for agents to start writing code immediately.

## Phase 1: Understand Current State

```bash
ak board list                  # existing boards
ak agent list                  # available agents
ak repo list                   # registered repos
git remote -v                  # repo URL (use this, never guess)
```

Read CLAUDE.md, DESIGN.md, and recent git history to understand:
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

```bash
ak board create --name "<version-or-name> — <theme>"
```

Create tasks with full specs. For each task:

1. **`--title`** — concise action phrase
2. **`--description`** — exhaustive spec including:
   - Files to create/modify
   - API endpoints, DB queries, UI components (concrete, not vague)
   - Patterns to follow from the existing codebase
3. **`--repo <id>`** — from `ak repo list`
4. **`--priority`** — urgent/high/medium/low
5. **`--labels`** — categorization (backend, frontend, cli, etc.)
6. **`--depends-on`** — task IDs this depends on

Create tasks in dependency order so earlier task IDs can be referenced:
```bash
T1=$(ak task create --board $BOARD --title "..." --repo $REPO --priority high --format json | jq -r .id)
T2=$(ak task create --board $BOARD --title "..." --repo $REPO --depends-on $T1 --format json | jq -r .id)
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
- Export Hono sub-app, mount via app.route() in index.ts
- Use D1 prepared statements
```

Vague descriptions produce vague code. Be specific.

## Phase 4: Assign

Match tasks to agents by role/capability:
```bash
ak task assign <task-id> --agent <agent-id>
```

Check existing agents. For a typical project you need:
- **fullstack-developer** or backend + frontend split

Create missing agents if needed:
```bash
ak agent create --template <template> --name "<Name>"
```

## Rules

- **Always get repo URL from `git remote -v`** — never guess
- **Discuss the plan with the user before creating tasks** — don't just start creating
- **Set depends-on at creation time** — don't leave deps for later
- **Space API calls** — avoid triggering rate limits during batch creation
- **Respect CLAUDE.md** — follow all project conventions and UI principles
- **Pre-install shared dependencies in scaffold** — avoid parallel install conflicts
- **Tasks touching the same files must be sequential** (depends-on)
- **Tasks touching different files can be parallel**
