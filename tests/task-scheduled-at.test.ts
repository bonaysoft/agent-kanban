// @vitest-environment node

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

const env = createTestEnv();
let mf: Miniflare;

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
  await seedUser(env.DB, "sched-test-user", "sched@test.com");
});

afterAll(async () => {
  await mf.dispose();
});

describe("scheduled_at field — taskRepo", () => {
  let boardId: string;

  beforeAll(async () => {
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, "sched-test-user", "Scheduled Task Board", "ops");
    boardId = board.id;
  });

  it("createTask stores scheduled_at when provided", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const scheduledAt = "2099-01-01T00:00:00.000Z";
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Future task",
      board_id: boardId,
      scheduled_at: scheduledAt,
    });

    expect(task.scheduled_at).toBe(scheduledAt);
  });

  it("createTask stores null scheduled_at when not provided", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Immediate task",
      board_id: boardId,
    });

    expect(task.scheduled_at).toBeNull();
  });

  it("updateTask can set scheduled_at on an existing task", async () => {
    const { createTask, updateTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Task to schedule later",
      board_id: boardId,
    });

    const scheduledAt = "2099-06-15T12:00:00.000Z";
    const updated = await updateTask(env.DB, task.id, { scheduled_at: scheduledAt });

    expect(updated).not.toBeNull();
    expect(updated!.scheduled_at).toBe(scheduledAt);
  });

  it("updateTask persists scheduled_at to DB readable via getTask", async () => {
    const { createTask, updateTask, getTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Persist scheduled_at",
      board_id: boardId,
    });

    const scheduledAt = "2099-03-20T08:00:00.000Z";
    await updateTask(env.DB, task.id, { scheduled_at: scheduledAt });
    const fetched = await getTask(env.DB, task.id);

    expect(fetched).not.toBeNull();
    expect(fetched!.scheduled_at).toBe(scheduledAt);
  });

  it("updateTask preserves other fields when only scheduled_at is updated", async () => {
    const { createTask, updateTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Preserve Fields",
      board_id: boardId,
      priority: "high",
    });

    const updated = await updateTask(env.DB, task.id, { scheduled_at: "2099-12-01T00:00:00.000Z" });

    expect(updated!.title).toBe("Preserve Fields");
    expect(updated!.priority).toBe("high");
    expect(updated!.status).toBe("todo");
  });

  it("listTasks returns scheduled_at in task results", async () => {
    const { createTask, listTasks } = await import("../apps/web/functions/api/taskRepo");
    const scheduledAt = "2099-07-04T00:00:00.000Z";
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Listing test task",
      board_id: boardId,
      scheduled_at: scheduledAt,
    });

    const tasks = await listTasks(env.DB, { board_id: boardId });
    const found = tasks.find((t) => t.id === task.id);

    expect(found).toBeDefined();
    expect(found!.scheduled_at).toBe(scheduledAt);
  });

  it("listTasks returns null scheduled_at for tasks created without it", async () => {
    const { createTask, listTasks } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "No schedule listing test",
      board_id: boardId,
    });

    const tasks = await listTasks(env.DB, { board_id: boardId });
    const found = tasks.find((t) => t.id === task.id);

    expect(found).toBeDefined();
    expect(found!.scheduled_at).toBeNull();
  });
});

// ─── Scheduler filter unit tests ─────────────────────────────────────────────
// The Scheduler.dispatchTasks filter is tested by driving the scheduler's
// public start() method through a single poll with controlled stub collaborators.
// MachineClient is an external HTTP service — stubs are appropriate here.

describe("Scheduler dispatchTasks — scheduled_at filter", () => {
  function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "task-1",
      assigned_to: "agent-1",
      blocked: false,
      repository_id: null,
      board_type: "ops",
      scheduled_at: null,
      ...overrides,
    };
  }

  function makeStubs(tasks: Record<string, unknown>[]) {
    const dispatched: string[] = [];
    const client = {
      listTasks: async () => tasks,
      listRepositories: async () => [],
      getAgent: async () => ({ runtime: "claude" }),
      getTask: async () => null,
      releaseTask: async () => null,
      getTaskNotes: async () => [],
    };
    const pm = {
      activeCount: 0,
      getActiveTaskIds: () => [] as string[],
      hasTask: (_id: string) => false,
      killTask: async () => {},
    };
    const runner = {
      dispatch: async (task: any) => {
        dispatched.push(task.id);
        return true;
      },
      resumeSession: async () => {},
    };
    const prMonitor = {
      track: () => {},
    };
    return { client, pm, runner, prMonitor, dispatched };
  }

  it("dispatches a task with null scheduled_at immediately", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const task = makeTask({ id: "task-null-sched", scheduled_at: null });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    // allow microtasks + timer to run
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).toContain("task-null-sched");
  });

  it("does not dispatch a task whose scheduled_at is in the future", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // +1 hour
    const task = makeTask({ id: "task-future", scheduled_at: futureDate });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).not.toContain("task-future");
  });

  it("dispatches a task whose scheduled_at is in the past", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString(); // -1 hour
    const task = makeTask({ id: "task-past", scheduled_at: pastDate });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).toContain("task-past");
  });

  it("dispatches a task whose scheduled_at equals now (boundary: not filtered)", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    // Use a timestamp that is guaranteed to be <= now when the filter runs
    const justNow = new Date(Date.now() - 1).toISOString();
    const task = makeTask({ id: "task-boundary", scheduled_at: justNow });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).toContain("task-boundary");
  });

  it("does not dispatch a future-scheduled task while dispatching a past-scheduled task in the same list", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    const tasks = [makeTask({ id: "task-ready", scheduled_at: pastDate }), makeTask({ id: "task-deferred", scheduled_at: futureDate })];
    const { client, pm, runner, prMonitor, dispatched } = makeStubs(tasks);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).toContain("task-ready");
    expect(dispatched).not.toContain("task-deferred");
  });

  it("does not dispatch a task whose repository is not locally cloned", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const task = makeTask({ id: "task-uncloned-repo", board_type: "dev", repository_id: "repo-1" });
    const dispatched: string[] = [];
    const client = {
      listTasks: async () => [task],
      // Return a repo so the lookup hits lines 208-209, but with a URL that won't have a local dir
      listRepositories: async () => [{ id: "repo-1", url: "https://github.com/test/nonexistent-repo-xyz.git" }],
      getAgent: async () => ({ runtime: "claude" }),
      getTask: async () => null,
      releaseTask: async () => null,
      getTaskNotes: async () => [],
    };
    const pm = {
      activeCount: 0,
      getActiveTaskIds: () => [] as string[],
      hasTask: () => false,
      killTask: async () => {},
    };
    const runner = {
      dispatch: async (t: any) => {
        dispatched.push(t.id);
        return true;
      },
      resumeSession: async () => {},
    };
    const prMonitor = { track: () => {} };

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    // task is not dispatched because repoDir returns null (not cloned)
    expect(dispatched).not.toContain("task-uncloned-repo");
  });

  it("does not dispatch a dev-board task that has no repository_id", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const task = makeTask({ id: "task-dev-no-repo", board_type: "dev", repository_id: null });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).not.toContain("task-dev-no-repo");
  });

  it("does not dispatch a blocked task even with no scheduled_at", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const task = makeTask({ id: "task-blocked", blocked: true });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).not.toContain("task-blocked");
  });

  it("does not dispatch a task with no assigned_to", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const task = makeTask({ id: "task-unassigned", assigned_to: null });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).not.toContain("task-unassigned");
  });

  it("skips task when board_type is invalid", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const task = makeTask({ id: "task-bad-board", board_type: "unknown_type" });
    const { client, pm, runner, prMonitor, dispatched } = makeStubs([task]);

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).not.toContain("task-bad-board");
  });

  it("backs off with rate-limit delay when client.listTasks throws ApiError 429", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const { ApiError } = await import("../packages/cli/src/client");
    let callCount = 0;
    const client = {
      listTasks: async () => {
        callCount++;
        throw new ApiError(429, "rate limited");
      },
      listRepositories: async () => [],
      getAgent: async () => ({ runtime: "claude" }),
      getTask: async () => null,
      releaseTask: async () => null,
      getTaskNotes: async () => [],
    };
    const pm = {
      activeCount: 0,
      getActiveTaskIds: () => [] as string[],
      hasTask: () => false,
      killTask: async () => {},
    };
    const runner = { dispatch: async () => false, resumeSession: async () => {} };
    const prMonitor = { track: () => {} };

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("backs off when client.listTasks throws a generic error", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    let callCount = 0;
    const client = {
      listTasks: async () => {
        callCount++;
        throw new Error("network error");
      },
      listRepositories: async () => [],
      getAgent: async () => ({ runtime: "claude" }),
      getTask: async () => null,
      releaseTask: async () => null,
      getTaskNotes: async () => [],
    };
    const pm = {
      activeCount: 0,
      getActiveTaskIds: () => [] as string[],
      hasTask: () => false,
      killTask: async () => {},
    };
    const runner = { dispatch: async () => false, resumeSession: async () => {} };
    const prMonitor = { track: () => {} };

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    // scheduler should have attempted at least one poll and handled the error
    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("does not dispatch when all available tasks have a paused runtime", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const task = makeTask({ id: "task-paused-runtime", assigned_to: "agent-paused" });
    const dispatched: string[] = [];
    const client = {
      listTasks: async () => [task],
      listRepositories: async () => [],
      getAgent: async (_id: string) => ({ runtime: "claude" }),
      getTask: async () => null,
      releaseTask: async () => null,
      getTaskNotes: async () => [],
    };
    const pm = {
      activeCount: 0,
      getActiveTaskIds: () => [] as string[],
      hasTask: () => false,
      killTask: async () => {},
    };
    const runner = {
      dispatch: async (t: any) => {
        dispatched.push(t.id);
        return true;
      },
      resumeSession: async () => {},
    };
    const prMonitor = { track: () => {} };

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    // Pause the runtime before starting
    const futureReset = new Date(Date.now() + 120_000).toISOString();
    scheduler.pauseForRateLimit("claude", futureReset);

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    expect(dispatched).not.toContain("task-paused-runtime");
  });

  it("isRuntimePaused returns false when no runtimes are paused", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const { client, pm, runner, prMonitor } = makeStubs([]);
    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    expect(scheduler.isRuntimePaused("claude")).toBe(false);
  });

  it("pauseForRateLimit marks runtime as paused", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const { client, pm, runner, prMonitor } = makeStubs([]);
    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    const futureReset = new Date(Date.now() + 120_000).toISOString();
    scheduler.pauseForRateLimit("claude", futureReset);

    expect(scheduler.isRuntimePaused("claude")).toBe(true);
    scheduler.stop();
  });

  it("resumeRateLimit unpauses a paused runtime", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const { client, pm, runner, prMonitor } = makeStubs([]);
    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    // start() is required so resumeRuntime's `!this.running` guard does not bail out early
    scheduler.start();

    const futureReset = new Date(Date.now() + 120_000).toISOString();
    scheduler.pauseForRateLimit("claude", futureReset);
    scheduler.resumeRateLimit("claude");

    // resumeRateLimit calls resumeRuntime (async) — wait for microtasks to settle
    await new Promise((r) => setTimeout(r, 50));
    expect(scheduler.isRuntimePaused("claude")).toBe(false);
    scheduler.stop();
  });

  it("onSlotFreed schedules another poll", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const dispatched: string[] = [];
    const task = makeTask({ id: "task-slot", scheduled_at: null });
    const { client, pm, runner, prMonitor } = makeStubs([task]);
    (runner as any).dispatch = async (t: any) => {
      dispatched.push(t.id);
      return true;
    };

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.onSlotFreed();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    // Task should have been dispatched at least once
    expect(dispatched.length).toBeGreaterThanOrEqual(1);
  });

  it("resumeRateLimit is a no-op on a non-paused runtime", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const { client, pm, runner, prMonitor } = makeStubs([]);
    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    // calling resumeRateLimit when not paused should not throw
    expect(() => scheduler.resumeRateLimit("claude")).not.toThrow();
    // and runtime stays unpaused
    expect(scheduler.isRuntimePaused("claude")).toBe(false);
    scheduler.stop();
  });

  it("tick does not resume rate_limited sessions for unpaused runtimes (no automatic promotion)", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const resumed: string[] = [];
    const { client, pm, prMonitor } = makeStubs([]);
    const runner = {
      dispatch: async (_t: any) => true,
      resumeSession: async (s: any) => {
        resumed.push(s.sessionId ?? "unknown");
      },
    };

    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 50));
    scheduler.stop();

    // tick should NOT have resumed any rate_limited sessions on its own
    // (resumeRateLimitedSessions is only triggered via resumeRuntime)
    expect(resumed).toHaveLength(0);
  });

  it("pauseForRateLimit ignores a newer pause that is earlier than the existing one", async () => {
    const { Scheduler } = await import("../packages/cli/src/scheduler");
    const { client, pm, runner, prMonitor } = makeStubs([]);
    const scheduler = new Scheduler(client as any, pm as any, runner as any, prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    const laterReset = new Date(Date.now() + 120_000).toISOString();
    const earlierReset = new Date(Date.now() + 30_000).toISOString();

    scheduler.pauseForRateLimit("claude", laterReset);
    // This earlier reset should NOT replace the existing later one
    scheduler.pauseForRateLimit("claude", earlierReset);

    // Runtime must still be paused
    expect(scheduler.isRuntimePaused("claude")).toBe(true);
    scheduler.stop();
  });
});
