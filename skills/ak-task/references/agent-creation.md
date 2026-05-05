# Agent Creation

Creating a worker is a capability design decision. Do not create an agent from `role` and `runtime` alone.

AK agents are persona-backed workers. Their runtime, model, soul, skills, and subagents decide the quality of future task execution. A weak worker profile pushes the human back into the loop; a complete worker profile makes unattended delivery possible.

Before creating or replacing any worker, design and preview the full profile.

## Capability Level

Choose runtime and model together.

- Senior worker: use a top-tier model such as Claude Opus or a GPT-5.5-class model. Use for architecture, broad refactors, cross-module changes, production-risk work, ambiguous product logic, and tasks requiring strong engineering judgment.
- Standard worker: use a Sonnet-class or comparable model. Use for well-scoped implementation, routine fixes, small UI/API changes, and tasks with clear acceptance criteria.

Do not assign complex, ambiguous, high-risk, or cross-cutting work to a standard worker just because that runtime is available.

Runtime constrains model choice:

- Claude runtime: Claude-family models such as Opus or Sonnet.
- Codex runtime: GPT-family coding models.
- Copilot runtime: may support Claude-family and GPT-family models depending on local/provider configuration.

Discover model names from the runtime instead of hardcoding them:

```bash
ak get model --runtime <runtime> -o json
```

`ak get model` must use provider-owned discovery, not a project-maintained model list:

- Codex: local Codex model cache.
- Claude: Claude SDK supported models.
- Copilot: Copilot authenticated model endpoint.
- Gemini: public Gemini model API when an API key is configured; otherwise Gemini CLI OAuth + Code Assist quota buckets.

Use a provider-reported model ID when setting `spec.model`. If `ak get model` fails because the runtime/provider does not expose model listing or lacks model-list credentials, ask during the initial clarification phase or use `default` only when the task is low-risk and clearly scoped. Do not invent model IDs from memory.

## Quality Harness

The goal is to take the human out of the loop. Implementation workers should carry a standard quality harness unless the task is explicitly trivial or the user says not to.

Required harness subagents for implementation workers:

- Test specialist: writes and updates tests, runs relevant checks, diagnoses failures, and owns test-code fixes.
- Review specialist: reviews the final source and test diff for bugs, regressions, missing tests, maintainability, security, performance, and architecture.

The primary worker owns implementation, integration, and final judgment. Subagents provide focused evidence; they do not replace ownership or approve completion.

If the standard harness cannot be attached, do not silently continue. Either create or reuse the missing specialists, or state in the worker profile preview why the omission is acceptable for this task.

## Worker Profile Preview

Before creating a worker, show the profile during the same initial confirmation phase as the task preview:

```text
Worker Profile Preview

Name:
Username:
Runtime:
Model:
Capability level: senior | standard
Role:
Bio:
Soul:
Skills:
Subagents:
- Test specialist:
- Review specialist:
Handoff targets:
Why this profile fits the task:
Create this worker? (y/n)
```

Never silently omit `model`, `skills`, or `subagents`. If a field is intentionally empty, write `default` or `none` and explain why in the preview.

## Field Rules

- `runtime`: required. It must be schedulable before creating or assigning the worker.
- `model`: required as an explicit decision. Query `ak get model --runtime <runtime> -o json` before choosing a concrete model. Use `default` only with a reason, or when model listing is unsupported and the task does not require a named senior model.
- `role`: required. Use kebab-case and match durable responsibility, not one temporary task.
- `bio`: required. State the worker's durable responsibility in one concise sentence.
- `soul`: required. Define engineering bar, autonomy expectations, when to use subagents, how to integrate their findings, fail-fast behavior, and what the worker must not do.
- `skills`: required as an explicit decision. Use installable `<source>@<skill>` refs or `none` with a reason.
- `subagents`: required as an explicit decision. Use existing worker IDs or `none` with a reason.
- `handoff_to`: required as an explicit decision. Use kebab-case roles for independent follow-up work or `none`.

Do not list the `agent-kanban` lifecycle skill in `skills`; the daemon installs it automatically.

## Skills

Skills are durable workflow or domain capabilities, not one-off task notes.

Add a skill when:

- The worker will repeatedly need that workflow or domain guidance.
- The skill is installable as `<source>@<skill>`.
- The skill materially improves unattended execution quality.

If the needed skill is unclear, use the `find-skills` skill during the initial worker-profile design phase to search for a suitable installable skill. Only add skills that are actually installable and relevant to the worker's durable role.

Do not add:

- `agent-kanban`, because daemon installs it automatically.
- Temporary task details.
- Broad unrelated skills.
- Free-form capability descriptions that are not installable skill refs.

If a carried subagent owns a narrow responsibility, put the specialist skill on that subagent when possible. Put the skill on the primary worker only when the primary worker must directly follow it.

## Subagents

Subagents are existing worker agents, not inline definitions.

For implementation workers, prefer attaching both standard harness subagents:

- A `test-specialist`.
- A `review-specialist`.

Create or reuse specialists before creating the primary worker, then put their agent IDs in `spec.subagents`.

When `spec.subagents` is non-empty, the primary worker's `soul` must say:

- When each subagent should be called.
- What each subagent owns.
- What output is expected.
- Which decisions stay with the primary worker.
- How findings are verified and integrated.

Do not create broad sets of specialists by default. Add more than test/review only when the task needs a durable specialist context, such as acceptance for product-level E2E validation.

## Handoff

Use `subagents` for work inside the same task and same deliverable.

Use `handoff_to` for independent follow-up work discovered during the task. Handoff is not for reviewing the current PR, running the current task's tests, or doing acceptance for the current task.

## Agent YAML

Create workers by generating an Agent YAML from the current task context:

```yaml
kind: Agent
metadata:
  name: alex-chen
  annotations:
    agent-kanban.dev/nickname: "Alex Chen"
spec:
  runtime: codex
  model: <provider-reported-model-id>
  role: fullstack-engineer
  bio: Senior fullstack engineer focused on end-to-end implementation quality.
  soul: |
    I own implementation from task clarification through review-ready delivery.
    I use the test specialist for focused test coverage and failure diagnosis.
    I use the review specialist for final diff review before submitting the task.
    I integrate their findings myself and keep responsibility for the final result.
    I fail fast when a required external authorization or production mutation is needed.
  skills:
    - <source>@<domain-skill>
  handoff_to:
    - <role>
  subagents:
    - <test-specialist-agent-id>
    - <review-specialist-agent-id>
```

Then apply and verify:

```bash
ak apply -f agent.yaml
ak describe agent <username> --version latest
ak get agent -o json
```

Verify the created worker is visible and `runtime_available: true` before assigning the task. For named models, verify the model was returned by `ak get model --runtime <runtime> -o json`.

## Replacement Workers

When replacing an unavailable worker, preserve the required capability profile, not only the role string:

- `role`
- `bio`
- `soul`
- `runtime`
- `model`
- `skills`
- `subagents`
- `handoff_to`

If the source profile cannot be reproduced on the target runtime, ask during the initial phase or fail fast before creating the task.
