# Agent Kanban — Product Vision

Created: 2026-03-20
Status: ACTIVE

## Core Principle

Agent Kanban is an **agent coordination layer**, not an agent itself. We never build our own agent runtime. We integrate with existing agent CLIs (Claude Code, Codex CLI, Gemini CLI, etc.) and provide them with: task awareness, identity, communication channels, and dispatch capabilities.

## Evolution Path

```
v1:  Human creates → Human starts Agent in terminal → Agent works via CLI
     Web UI = viewer only. Agent logs to kanban via CLI.

v2:  Web UI becomes Agent interaction surface
     Agent logs visible in real-time on web.
     Click agent → see work history → chat with agent (when idle).
     Assign replaces Claim as primary dispatch mechanism.

v3:  Machine registration + dispatch layer
     CLI `start` → persistent process → Machine registered.
     Orchestrator agent auto-assigns tasks to Machines.
     Each Machine spawns agents per task.

v4:  Role & Skill system
     Agent = generic runtime + loaded Skills = Role.
     Built-in roles + user-defined roles.
     Orchestrator matches task → role → Machine → dispatch.
```

## v2 — Agent Interaction on Web

### Agent Identity

Each agent that interacts with the system has a persistent identity:
- Name (user-assigned or auto-generated)
- Avatar/icon (distinguishes agents visually)
- Activity history (all tasks claimed, logs, completions)

v1 already has `assigned_to` and `created_by` fields on tasks, and agent identity via API key `name`. v2 elevates this from a string field to a first-class entity.

### Agent Behavior Logs in Web UI

The task detail view's activity log timeline currently shows structured log entries (claimed, commented, completed). v2 extends this to show **agent behavior in real-time** — not just what the agent reported via `POST /api/tasks/:id/logs`, but a richer stream of what the agent is doing.

Key constraint: we don't control the agent's output. We consume it. The communication channel must work with agents as black boxes that speak CLI.

Possible approaches:
- **Structured log streaming:** Agent CLI pushes structured events via a streaming endpoint (SSE or WebSocket). The web UI renders these as a live timeline.
- **AI Element components:** Investigate component libraries designed for rendering AI/agent activity (chat bubbles, thinking indicators, tool use visualization). This could provide ready-made UI for agent interaction without building from scratch.
- **Terminal-in-browser:** For the "chat with agent" feature, embed a terminal-like interface in the task detail panel. When an agent is idle (task completed or paused), the user can send messages and see responses — same interaction model as using the agent in a real terminal.

### Assign vs Claim

v1: `POST /api/tasks/:id/claim` — agent self-selects work.
v2: `POST /api/tasks/:id/assign` — platform (or user, or orchestrator) assigns work to a specific agent.

Claim remains for backward compatibility and ad-hoc agent usage. Assign is the primary dispatch mechanism when machines are registered.

## v3 — Machine Registration & Dispatch

### Machine Concept

A Machine is a compute environment where agents can run. It could be:
- A developer's local laptop
- A cloud VM / container
- A CI runner
- A sandbox environment

### Registration Flow

```
$ agent-kanban start
  → starts persistent process
  → registers Machine with platform (name, capabilities, status)
  → establishes communication channel (WebSocket or long-poll)
  → heartbeat keeps registration alive
  → receives task assignments from platform
  → spawns agent process per task
  → reports agent output back to platform
```

### Dispatch Layer

The dispatch layer is itself an agent (or a simple rules engine). It:
1. Watches the board for tasks in "Todo" that are unblocked
2. Matches task requirements to available Machines
3. Assigns task to Machine
4. Machine spawns an agent process for the task
5. Agent works, reports via CLI, completes
6. Dispatch layer monitors and handles failures (timeout, crash, retry)

Core principle: the dispatch layer does NOT execute tasks. It coordinates. Execution is always delegated to agent CLIs running on Machines.

## v4 — Role & Skill System

### The Insight

Claude Code (or any agent CLI) is a **generic agent**. It can do anything, but it doesn't know about your specific workflows, tools, or conventions until you tell it. Skills are the mechanism for specialization.

### Agent Roles

A Role = a named configuration of:
- Skills (loaded into the agent's context)
- System instructions (behavior guidelines)
- Tool access (what the agent can use)
- Constraints (what the agent should NOT do)

### Built-in Roles (examples)

| Role | Skills | Purpose |
|------|--------|---------|
| Code Reviewer | review, investigate | Reviews PRs, finds bugs |
| Feature Builder | plan-eng-review, qa | Implements features end-to-end |
| Bug Fixer | investigate, qa | Debugs and fixes issues |
| Docs Writer | document-release | Keeps documentation current |
| DevOps | ship, careful | Handles deployment and infra |

### User-Defined Roles

Users can create custom roles:
1. Name the role
2. Select skills to load
3. Optionally write custom system instructions
4. Save → role is available for assignment

### Role-Task Matching

Three matching modes that coexist, with different emphasis per version:

**Mode A: Agent self-selects role (smart contractor)**
Agent reads task description → queries `GET /api/roles` for available roles + skills → decides which role fits → claims with that role. The matching logic lives in the agent's skill, not in the platform. Suitable for v2 manual-trigger scenarios.

**Mode B: Task specifies required role (job posting)**
Human creates task with a `required_role` tag. Only agents with that role can claim or be assigned. Suitable for human-directed assignment.

**Mode C: Dispatcher matches (headhunter)**
Dispatch agent watches tasks + available roles + available Machines → decides the optimal assignment. Suitable for v3 full automation. Modes A and B serve as fallbacks.

**API for role matching (v2):**
```
GET  /api/roles                    -- List roles (name, description, skills[])
GET  /api/roles/:id                -- Role detail
POST /api/roles                    -- Create role (user-defined)
POST /api/tasks/:id/claim          -- Claim with role: { role_id: "bug-fixer" }
```

Agent decision flow:
1. `GET /api/roles` → get all roles with their skills
2. `GET /api/tasks?status=todo` → get available tasks
3. Agent matches task description to role skills (logic in agent's skill, not platform)
4. `POST /api/tasks/:id/claim { role_id: "bug-fixer" }` → claim as that role

### Two-Layer Agent Model

```
Role Layer (capability definition)
  ├── Built-in roles (pre-loaded skills)
  ├── User-defined roles (custom skill combinations)
  └── Finite set — like job descriptions

Agent Instance Layer (execution)
  ├── Each CLI session (Claude Code process) = one agent instance
  ├── Ephemeral — created on claim, done when task completes
  ├── Picks a role when claiming (or gets assigned one)
  └── Infinite instances — like contractors
```

This is the "outsourcing" model: roles are limited (job types), but agent instances are unlimited (contractors come and go). The platform manages roles and tracks instances; execution is always delegated to external agent CLIs.

## Identity & Auth Architecture

### v1: Machine-Level Auth + Auto-Registered Agents

```
api_keys (represents a Machine, not an Agent)
  id, key_hash, name (machine name), created_at

agents (lightweight, auto-registered on claim)
  id, machine_id → api_keys.id, name (auto-generated), role_id (null in v1), created_at

tasks
  assigned_to → agents.id (not api_key name)
  created_by  → agents.id or "human"
```

One API key per Machine. One Machine can have many concurrent agent instances. Agent instances are auto-created when they first claim or create a task — zero manual setup.

### v2+: Role-Aware Agents

```
roles (new table)
  id, name, description, skills (JSON), system_prompt, created_by, created_at

agents (add role_id)
  role_id → roles.id (which role this instance is using)
```

## Key Design Constraints

1. **We don't build execution agents.** The dispatch/orchestration agent is ours. The agents that do the actual work (coding, reviewing, fixing) are external CLIs (Claude Code, Codex, Gemini CLI, etc.).
2. **CLI is always the primary interface for agents.** Web UI extends but never replaces CLI.
3. **Each version's data model must be forward-compatible.** v1 fields (assigned_to, created_by) evolve into v2 entities (Agent) without breaking changes.
4. **The system must work without the dispatch layer.** Manual claim/assign via CLI is always available. The dispatch layer is an automation layer on top, not a requirement.
