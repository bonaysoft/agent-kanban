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

## Assignment Rules

1. Pick a worker whose `role` matches the task.
2. Exclude workers with `runtime_available !== true`.
3. Prefer the matching worker with the lowest `active_task_count`, then lowest `queued_task_count`.
4. If no matching worker is schedulable, create a worker for the same role on a schedulable runtime.
5. If a matching worker exists only on an unavailable runtime, copy its role, soul, skills, and handoff settings into the new worker.
6. Do not assign to a runtime just because the CLI exists on a machine. Runtime availability is whatever AK reports.

## Creating Workers

Create workers only when needed for the current plan:

- Missing role.
- Matching role exists but every matching worker has unavailable runtime.
- Matching workers are already busy and the plan needs parallel execution.

Do not create duplicate workers for hypothetical future work.

## Runtime Failure Handling

If an assignment fails because the runtime is unavailable, refresh agent data and choose again:

```bash
ak get agent -o json
```

If the desired role is unavailable, create a replacement worker on an available runtime and assign to it.
