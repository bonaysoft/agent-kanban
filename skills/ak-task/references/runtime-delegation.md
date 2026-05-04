# Runtime-Aware Delegation

AK provides data. The leader makes the scheduling decision.

Before assigning tasks or creating workers, run:

```bash
ak get agent -o json
```

Use these fields:

- `kind`: assign implementation tasks only to workers, not leaders.
- `role`: match the task domain first.
- `runtime`: the worker's runtime.
- `runtime_available`: only `true` is schedulable.
- `queued_task_count`: todo tasks already assigned to the worker.
- `active_task_count`: in-progress tasks currently owned by the worker.

## Runtime Choice

If multiple runtimes are schedulable for the needed role and the user has not expressed a runtime preference, ask which runtime to use before creating a new worker or assigning the task. Present only runtimes with `runtime_available: true`, plus the relevant trade-off: existing matching worker, current load, model preference, or runtime-specific capability.

Do not ask when there is only one schedulable runtime, the user already specified a runtime, or an existing matching worker is clearly the best choice by role and load.

## Assignment Rules

1. Pick a worker whose `role` matches the task.
2. Exclude workers with `runtime_available !== true`.
3. Prefer the matching worker with the lowest `active_task_count`, then lowest `queued_task_count`.
4. If no matching worker is schedulable, create a worker for the same role on a schedulable runtime.
5. If a matching worker exists only on an unavailable runtime, copy its role, soul, skills, and handoff settings into the new worker.
6. Do not assign to a runtime just because the CLI exists on a machine. Runtime availability is whatever AK reports.

## Creating Workers

Create workers only when needed for the current task:

- Missing role.
- Matching role exists but every matching worker has unavailable runtime.
- The task should run now and matching workers are already busy.

Do not create duplicate workers for hypothetical future work.

## Complex Task Execution Model

For complex but coherent work, prefer one primary worker carrying focused task-local subagents over splitting the same outcome across multiple role-based workers. The primary worker owns the task, implementation direction, final integration, and review submission. Subagents handle independent, narrow work that would otherwise bloat the primary worker's context and cause attention drift.

Subagents are existing worker agents, not inline definitions. Create or reuse the specialist workers first, then put their agent IDs in the primary worker's `spec.subagents`.

Good reusable subagent profiles:

- Test specialist: writes focused tests, runs relevant checks, diagnoses failures, and fixes test code when the failure is in the test.
- Review specialist: reviews the final diff for bugs, maintainability, security, performance, architecture, and other durable quality concerns.
- Acceptance specialist: validates the completed product behavior from the user's perspective after implementation review, tests, and CI pass; uses E2E or manual acceptance checks to confirm the feature actually works before the task is completed.

Do not create all of these by default. Create or attach only the specialist subagents that the primary worker will repeatedly use. Do not split one stable specialist context into separate action agents such as writer, runner, fixer, or reviewer phases. Split specialists only when the work needs different durable domain context, review bar, or runtime.

For concrete specialist worker YAML examples, read `references/specialist-profiles.md`.

Creation order:

1. Create or reuse specialist worker agents with their own `role`, `bio`, `soul`, `runtime`, `model`, and `skills`.
2. Run `ak get agent -o json` and collect their agent IDs.
3. Create or update the primary worker with those IDs in `spec.subagents`.
4. In the primary worker's `soul`, define the collaboration contract: when each subagent should be called, what output is expected, which decisions stay with the primary worker, and how findings are verified before being acted on.

## Subagents vs Handoff

Use `subagents` for delegation inside the same task. The context overlaps with the primary task outcome, but a narrow specialist can inspect, test, review, or validate without loading the primary worker with every detail. The primary worker keeps ownership of the task, integrates the findings, and submits the same PR for review.

Use `handoff_to` for new independent work discovered while doing the task. The context overlap is low enough that it should become a separate task with its own description, owner, lifecycle, and review. Handoff is not for reviewing the current PR, running the current task's tests, or doing acceptance for the current task.

Rule of thumb:

- High context overlap + same deliverable → keep one task and use subagents if specialist focus helps.
- Low context overlap + separate deliverable → create a follow-up task through handoff.
- Shared files, data model, or API contract usually means high overlap; merge the work into one task or make it sequential with `--depends-on`.

Create workers by generating an Agent YAML from the current task context.

```yaml
kind: Agent
metadata:
  name: alex-chen
  annotations:
    agent-kanban.dev/nickname: "Alex Chen"
spec:
  runtime: codex
  model: gpt-5.1-codex
  role: frontend-reviewer
  bio: Frontend reviewer focused on React, Tailwind, accessibility, and visual consistency.
  soul: |
    I review frontend changes for user-facing correctness, accessibility, and visual consistency.
    I inspect the changed UI against the existing design system before suggesting new patterns.
    I verify responsive behavior and key interactions when the change affects layout or flow.
    When task-local subagents are installed, I delegate focused checks to them only where their role gives better coverage than doing it myself.
    I use a test specialist for focused test work, a review specialist for final diff review, and an acceptance specialist for product-level E2E validation when those specialists are attached.
    I keep ownership of the final decision, integrate their findings, and do not treat subagent output as approval.
  skills:
    - <source>@<domain-skill>
  handoff_to:
    - <role>
  subagents:
    - <test-specialist-agent-id>
    - <review-specialist-agent-id>
    - <acceptance-specialist-agent-id>
```

```bash
ak apply -f agent.yaml
ak get agent <username>
ak describe agent <username> --version latest
ak get agent -o json
```

Agent creation rules:

- `metadata.name` is the stable username. Use a human-like username such as `alex-chen`, not a role slug or temporary task name.
- `metadata.annotations["agent-kanban.dev/nickname"]` is the human nickname, such as `Alex Chen`.
- `spec.role` carries the job responsibility. Use kebab-case such as `frontend-reviewer`, `test-specialist`, or `acceptance-specialist`. Do not encode the role into the name.
- `spec.model` is optional. Set it only when the worker should use a specific model for its runtime.
- `spec.bio` is a short public responsibility summary.
- `spec.soul` is the worker's durable behavior policy: principles and decision rules that should affect future tasks for this agent.
- `skills` must be installable skill refs in `<source>@<skill>` format, matching what `npx skills add <source> --skill <skill>` can install.
- `handoff_to` should list kebab-case roles this agent may hand off newly discovered independent work to, not concrete agent IDs. At handoff time, the worker resolves the role to an available worker with `ak get agent -o json`.
- `subagents` should list existing worker agent IDs to install as task-local subagents for this agent. They must be created or discovered before applying the primary worker YAML.
- If `subagents` is non-empty, `soul` must say how this agent collaborates with those subagents: when to call them, what they own, and how their output is reviewed or integrated.
- Agent YAML updates the current `latest` profile for `metadata.name`. If the profile changed, AK keeps the previous `latest` as a hash-version snapshot.
- Use `ak get agent <username>` to list snapshots and `ak describe agent <username> --version latest` to inspect the current approved profile.
- Verify `runtime_available: true` before assigning any task to the new worker.

Skill selection rules:

- `skills` are installable skill references, not free-form capability descriptions.
- Do not list the `agent-kanban` lifecycle skill here; the daemon installs it automatically for AK workers.
- Add domain skills only when they provide concrete workflow, review, tool, or domain guidance the worker will repeatedly need.
- Match skills to the worker's durable role and expected task surface, not to one temporary assignment.
- Prefer a small, high-signal skill set. Do not add broad or unrelated skills just because they might help someday.
- If a carried subagent owns a narrow responsibility, put the specialist skill on that subagent when possible; put it on the primary worker only when the primary worker must directly follow that skill.
- If no installable skill exists for a repeated need, leave it out and describe the behavior in `soul`; workers may later propose adding a real skill when one becomes available.

Soul writing rules:

- Include durable workflow preferences, review bar, handoff rules, and domain-specific principles.
- Include subagent collaboration rules when `spec.subagents` is set.
- Write first-person behavior rules for the agent, not task instructions for one assignment.
- Keep platform workflow out of `soul`; task claim/review/CI/completion-note rules belong to the installed `agent-kanban` skill.
- Do not include one-off task context, project facts, secrets, temporary user preferences, or implementation todos.
- If the rule should disappear after one task, it does not belong in `soul`.

## Reviewing Agent Profile Candidates

Every completed worker task must include a completion summary. The leader must read the task notes before merging the PR and check whether the worker proposed an agent profile change. Workers may propose profile changes when their current `bio`, `soul`, `skills`, `subagents`, or handoff targets caused durable behavior that should change for future tasks. Treat these as candidates, not approvals.

When a worker proposes a candidate:

1. Read the reason and candidate Agent YAML.
2. Accept only if the change is durable, role-appropriate, and not task-specific.
3. Apply accepted candidates with `ak apply -f <file>`; this updates the current `latest` profile. If the profile changed, AK snapshots the previous latest.
4. Verify with `ak describe agent <username> --version latest` and `ak get agent <username>`.
5. Reject by leaving `latest` unchanged and telling the worker why.

Do not apply changes that store one-off task context, project facts, temporary user preferences, or fixes that belong in source code or task descriptions.

If no proposal is present, no agent version action is needed.

## Runtime Failure Handling

If an assignment fails because the runtime is unavailable, refresh agent data and choose again:

```bash
ak get agent -o json
```

If the desired role is unavailable, create a replacement worker on an available runtime and assign to it.
