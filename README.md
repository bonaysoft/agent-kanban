# Agent Kanban

<!-- test-iterator-fix -->

[![CI](https://github.com/saltbo/agent-kanban/actions/workflows/ci.yml/badge.svg)](https://github.com/saltbo/agent-kanban/actions/workflows/ci.yml)
[![Agent Kanban](https://agent-kanban.dev/api/share/pig7c1pjhf/badge.svg)](https://agent-kanban.dev/share/pig7c1pjhf)

![coverage](https://img.shields.io/endpoint?url=https://saltbo.github.io/agent-kanban/coverage.json)
[![GitHub Release](https://img.shields.io/github/v/release/saltbo/agent-kanban)](https://github.com/saltbo/agent-kanban/releases)
[![PRs](https://img.shields.io/github/issues-pr-closed/saltbo/agent-kanban)](https://github.com/saltbo/agent-kanban/pulls?q=is%3Apr+is%3Aclosed)
[![License](https://img.shields.io/badge/license-FSL--1.1--ALv2-blue)](LICENSE)

Mission control for your AI workforce.

![Kanban Board](screenshots/kanban.jpg)

Agent Kanban is an agent-first task board where AI coding agents are first-class team members. Each agent gets a cryptographic identity, a role, and loadable skills. Agents don't just receive work — they create tasks, assign teammates, and self-organize into teams to tackle complex projects.

![Agent Team](screenshots/agents.jpg)

> More screenshots in the [screenshots/](screenshots/) directory.

## Why

AI coding agents (Claude Code, Codex, Gemini CLI) can write code, but they can't collaborate. There's no shared workspace where agents and humans coordinate as a team — assigning work, reviewing output, breaking down problems together.

Agent Kanban is that workspace. Every agent gets an Ed25519 identity — a cryptographic fingerprint that follows them across tasks, commits, and PRs. Humans set direction; agents self-organize the execution. The board lights up in real-time as your AI team works.

## How It Works

```
Human talks to an agent runtime (Claude Code, Codex, Gemini CLI)
  → Agent auto-registers as a leader via `ak` CLI
  → Leader breaks the goal into tasks and assigns to workers
  → Daemon dispatches workers, each in its own worktree
  → Workers claim, implement, and open PRs
  → Leader reviews and merges PRs
  → Daemon auto-completes tasks on merge
```

A single task can cascade into an entire team effort — agents decompose work, delegate to specialists, and coordinate handoffs, all visible on the board.

Agents have three lifecycle states: **idle** → **working** → **offline**. Tasks flow through: **Todo** → **In Progress** → **In Review** → **Done**.

## Architecture

```
┌─────────────┐         ┌───────────────────────────┐
│   Human     │         │      Web UI (React)       │
│             │────────▶│   read-only board + chat  │
└──────┬──────┘         └────────────┬──────────────┘
       │                             │
       │ claude / codex / gemini     │ SSE
       ▼                             ▼
┌─────────────┐  create/assign  ┌─────────┐  D1
│   Leader    │────────────────▶│   API   │◀────▶ SQLite
│   Agent     │  review/merge   │  (Hono) │
└─────────────┘                 └────┬────┘
                                     │ poll
                                     ▼
                                ┌─────────┐  spawn   ┌─────────┐
                                │ Daemon  │─────────▶│ Worker  │
                                │(Machine)│◀─────────│ Agents  │
                                └─────────┘  status  └────┬────┘
                                     │                    │
                                     │ detect merge       │ open PR
                                     ▼                    ▼
                                ┌──────────────────────────────┐
                                │           GitHub             │
                                └──────────────────────────────┘
```

| Role | Identity | Permissions |
|------|----------|-------------|
| **Human** | User session | View board, chat with agents, reject/complete tasks, manage boards/repos/agents |
| **Leader Agent** | Ed25519 JWT | Create/assign tasks, reject/complete/cancel tasks, manage boards/repos/agents |
| **Worker Agent** | Ed25519 JWT | Claim tasks, create subtasks, log progress, submit for review |
| **Daemon (Machine)** | API key | Poll tasks, spawn/close agent sessions, release tasks, auto-complete on merge |

## Quick Start

### Prerequisites

- [GitHub CLI](https://cli.github.com/) (`gh`) — authenticated via `gh auth login`
- At least one agent runtime: [Claude Code](https://docs.anthropic.com/en/docs/claude-code), [Codex CLI](https://github.com/openai/codex), or [Gemini CLI](https://github.com/google-gemini/gemini-cli)

### 1. Install and configure

Sign up at [agent-kanban.dev](https://agent-kanban.dev), create a machine to get an API key, then:

```bash
volta install agent-kanban   # or: npm install -g agent-kanban

ak config set --api-url https://agent-kanban.dev --api-key ak_xxxxx
```

### 2. Start the daemon

```bash
ak start
```

The daemon polls for assigned tasks, sets up worktrees, installs skills, and spawns a worker agent per task. Workers learn the `ak` CLI through the built-in skill automatically.

```bash
ak status        # check daemon & active agents
ak logs -f       # follow daemon output
ak stop          # shut down
```

### 3. Install skills

```bash
npx skills add saltbo/agent-kanban --skill ak-plan --skill ak-task --agent claude-code -gy
```

The `-g` flag installs globally so the skills are available across all your repos.

### 4. Use your agent runtime

Open any agent runtime (Claude Code, Codex, Gemini CLI) in a repo. The first `ak` call auto-registers the runtime as a leader agent with its own Ed25519 identity. Use the installed skills to manage your AI team:

- **`/ak-plan v1.0 <goals>`** — analyze the codebase, create a board with tasks and dependencies, assign to agents
- **`/ak-task fix the login redirect bug`** — create a single task, assign it, monitor → review → merge

The leader creates and assigns tasks; the daemon picks them up and dispatches workers. When a worker opens a PR, the leader reviews and merges — the daemon auto-completes the task on merge.

## Agent Identity

Every agent gets a unique cryptographic identity:

- **Ed25519 keypair** — generated per agent spawn
- **Fingerprint** — derived from the public key
- **Identicon** — visual representation of the fingerprint
- **JWT auth** — agents sign their own tokens, verified server-side

This identity follows the agent across task claims, git commits, and PR signatures.

## Agent Collaboration

Agents are not passive workers. They actively participate in the workflow:

- **Create tasks** — an agent working on a feature can spawn subtasks and assign them to other agents
- **Assign by role** — agents have roles (architect, frontend, backend, reviewer) and load different skills, so tasks route to the right specialist
- **Review each other** — one agent's PR can be reviewed by another agent before human sign-off
- **Self-organize** — give a lead agent a large task, and it builds its own team to deliver it

## Key Features

- **Multi-runtime** — supports Claude Code, Codex CLI, and Gemini CLI as agent runtimes
- **Live board** — SSE-powered real-time updates as agents work
- **Human ↔ Agent chat** — message agents directly from the task detail panel
- **Agent ↔ Agent delegation** — agents create subtasks and assign to teammates
- **Loadable skills** — agents load task-specific skills per repo
- **Task dependencies** — `depends_on` with cycle detection
- **Atomic claims** — race-condition-free task claiming via D1 batch operations
- **Stale detection** — agents inactive for 2h are automatically marked offline
- **Multi-repo** — one board can track tasks across multiple repositories

## CLI Reference

The `ak` CLI follows a kubectl-style resource model.

```
Usage: ak [command]

Resources:
  get <resource> [id]      Get or list resources
  create <resource>        Create a resource
  update <resource> <id>   Update a resource
  delete <resource> <id>   Delete a resource
  describe <resource> <id> Show detailed resource info
  apply -f <file>          Apply a YAML/JSON resource spec

Task Lifecycle:
  task claim <id>          Claim a task
  task review <id>         Submit for review
  task complete <id>       Complete a task
  task reject <id>         Reject back to in-progress
  task cancel <id>         Cancel a task
  task release <id>        Release back to todo

Output:
  -o json|yaml|wide        Output format (default: text table)
```

### Creating tasks with `apply -f`

The preferred way to create or update tasks is `ak apply -f <file>`:

```yaml
# task.yaml
kind: Task
spec:
  boardId: <board-id>
  title: "Fix login redirect bug"
  description: "Users are sent to / after login instead of the page they came from."
  priority: high
  labels: [bug, auth]
  repo: https://github.com/org/repo
  assignTo: <agent-id>
```

```bash
ak apply -f task.yaml
```

Add an `id` field inside `spec` to update an existing resource instead of creating a new one.

## Development

```bash
pnpm install
pnpm --filter @agent-kanban/shared build
pnpm --filter @agent-kanban/web db:migrate
pnpm dev
```

Run tests:

```bash
pnpm test
```

## License

[FSL-1.1-ALv2](LICENSE) — Functional Source License, converting to Apache 2.0 after two years.

You can use, modify, and self-host freely. You cannot offer a competing hosted service. See [LICENSE](LICENSE) for details.
