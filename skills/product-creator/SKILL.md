---
name: product-creator
description: |
  Orchestrate a full product build with agent-kanban. Creates repo, assembles
  agent team, designs task DAG, monitors execution, reviews PRs, and delivers
  a deployable product. Use when asked to "build a product", "create a project",
  "orchestrate development", or "/creator <product idea>".
argument-hint: "[product idea]"
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

# Creator — Product Orchestration

You are the Creator: a lead agent that orchestrates other agents via agent-kanban
to build a deployable product from a product idea.

## Phase 1: Understand

Parse the user's input to determine:
- **Product name** — short, lowercase, suitable for a repo name
- **Tech stack** — default to Hono + Cloudflare Workers + D1 unless specified
- **Scope** — identify 2-5 deliverable units of work

If the input is ambiguous, use AskUserQuestion to clarify scope and stack.

## Phase 2: Scaffold

```bash
# Create and clone repo (NEVER inside an existing git repo)
gh repo create <owner>/<name> --public --description "<one-liner>" --clone
cd <repo-dir>

# Initialize project — use framework CLIs, install ALL dependencies upfront
npm init -y
npm install <runtime-deps>
npm install -D <dev-deps>

# Create config files, entry point, DB schema, .gitignore
# Commit and push
git add -A && git commit -m "feat: project scaffold" && git push -u origin master
```

The scaffold must contain enough structure (package.json, tsconfig, config files,
entry point) for agents to understand the tech stack and start writing code immediately.

## Phase 3: Register

```bash
ak board create --name "<Product Name>"
cd <repo-dir> && ak link
ak repo list --format json  # note the repo ID
```

## Phase 4: Assemble Team

```bash
ak agent list --format json
```

Check existing agents. For a typical web project you need:
- **fullstack-developer** or split into backend-developer + frontend-developer

Create missing agents:
```bash
ak agent create --template <template> --name "<Name>"
```

## Phase 5: Design Task DAG

Break the product into tasks. Each task must have:

1. **`--title`** — concise action phrase
2. **`--description`** — exhaustive spec including:
   - Files to create/modify
   - API endpoints, DB queries, UI components (concrete specs, not vague goals)
   - Patterns to follow from the existing codebase
3. **`--repo <repo-id>`** — the registered repo ID
4. **`--assign-to <agent-id>`** — which agent executes this
5. **`--depends-on <ids>`** — dependency ordering
6. **`--priority`** — high for foundation tasks, medium for features

DAG design rules:
- Foundation first (API/data layer), then features that build on it
- Tasks that touch the same files must be sequential (depends-on)
- Tasks that touch different files can be parallel
- Pre-install all shared dependencies in the scaffold to avoid parallel conflicts

```bash
T1=$(ak task create --title "..." --description "..." --repo $REPO --assign-to $AGENT --priority high --format json | jq -r .id)
T2=$(ak task create --title "..." --description "..." --repo $REPO --assign-to $AGENT --depends-on "$T1" --format json | jq -r .id)
```

## Phase 6: Execute

Ensure the daemon is running:
```bash
ak start --poll-interval 10000
```

The daemon automatically:
1. Runs quality-gate setup (lefthook) on first task
2. Picks up unblocked, assigned tasks
3. Spawns an agent per task
4. Agents claim → implement → push branch → create PR → submit review

Monitor with `ak task list --format json` or `ak board view`. Space queries
10+ seconds apart to avoid hitting rate limits while the daemon is polling.

## Phase 7: Review

When a task reaches `in_review`, review the PR:

```bash
gh pr view <number> --repo <owner/name>
gh pr diff <number> --repo <owner/name>
```

**Accept**: Code meets the spec, compiles, follows conventions.
```bash
gh pr merge <number> --repo <owner/name> --merge --delete-branch
```
The daemon auto-completes the task on merge and unblocks dependents.

**Request changes**: Code doesn't meet spec or has issues.
```bash
gh pr review <number> --repo <owner/name> --request-changes --body "..."
```

If a PR has merge conflicts from parallel work, fetch the branch, rebase on
master, resolve conflicts, and push.

## Phase 8: Deliver

Once all tasks are done:
```bash
cd <repo-dir> && git pull origin master
npx tsc --noEmit     # typecheck
npm run build         # build if applicable
```

Report to the user:
- Repo URL
- What was built
- How to deploy
- Any follow-up work suggested by agents

## Task Description Quality

This is the single most important factor. Agents are autonomous — the description
is their only input. A good description includes:

```
## Goal
One sentence: what this task produces.

## Files
- src/foo.ts — API route handlers
- src/bar.ts — data access layer

## Spec
POST /api/items — create item
  Request: { "name": string, "value": number }
  Response: 201 { "id": 1, "name": "...", "value": 0 }
  Error: 400 if name missing, 409 if duplicate

GET /api/items — list all items
  Response: { "items": [...] }

## Patterns
- Export Hono sub-app, mount via app.route() in index.ts
- Use D1 prepared statements
- Proper HTTP status codes
```

Vague descriptions produce vague code. Be specific.
