---
name: ak-plan
description: |
  Plan a version release for an existing project. Analyze codebase gaps, create
  a board with tasks and dependencies, assign to agents. Use when asked to
  "plan a version", "plan v1.4", "规划版本", or "/ak-plan <version> <goals>".
argument-hint: "<version> [goals]"
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

# ak-plan — Version Planning

Plan and create a version board with tasks for an existing project.

## Input

Parse the user's input:
- **Version** — e.g. "v1.4.0" (required)
- **Goals** — what this version should achieve (if not provided, ask)

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

Use Explore agents to thoroughly scan the codebase for gaps related to the version goals. Consider:
- Missing features vs stated goals
- Backend gaps (API, data model)
- CLI gaps (missing commands)
- Frontend gaps (if applicable, respect UI Principles in CLAUDE.md)
- Test coverage gaps

Present the analysis to the user and confirm scope before creating tasks.

## Phase 3: Create Board & Tasks

```bash
ak board create --name "<version> — <theme>"
```

Create tasks with full specs. For each task:

1. **`--title`** — concise action phrase
2. **`--description`** — detailed spec (files, endpoints, behavior)
3. **`--repo <id>`** — from `ak repo list` (or register with `ak repo add` using git remote URL)
4. **`--priority`** — urgent/high/medium/low
5. **`--labels`** — categorization (backend, frontend, cli, etc.)
6. **`--depends-on`** — task IDs this depends on

Create tasks in dependency order so earlier task IDs can be referenced:
```bash
T1=$(ak task create --board $BOARD --title "..." --repo $REPO --priority high --format json | jq -r .id)
T2=$(ak task create --board $BOARD --title "..." --repo $REPO --depends-on $T1 --format json | jq -r .id)
```

## Phase 4: Assign

Match tasks to agents by role/capability:
```bash
ak task assign <task-id> --agent <agent-id>
```

## Rules

- **Always get repo URL from `git remote -v`** — never guess
- **Discuss the plan with the user before creating tasks** — don't just start creating
- **Set depends-on at creation time** — don't leave deps for later
- **Space API calls** — avoid triggering rate limits during batch creation
- **Respect CLAUDE.md** — follow all project conventions and UI principles
