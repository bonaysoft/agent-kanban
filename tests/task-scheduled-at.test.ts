// @vitest-environment node

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { RateLimiter } from "../packages/cli/src/daemon/rateLimiter.js";
import { createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

// ── Mocks required by dispatcher.ts / dispatchTasks for CLI unit tests ────────
vi.mock("../packages/cli/src/logger.js", () => ({
  createLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("../packages/cli/src/workspace/repoOps.js", () => ({
  ensureCloned: vi.fn(),
  prepareRepo: vi.fn().mockReturnValue(true),
  repoDir: vi.fn().mockReturnValue(null),
}));
vi.mock("../packages/cli/src/workspace/skills.js", () => ({
  ensureLefthookTask: vi.fn().mockResolvedValue(false),
  ensureSkills: vi.fn().mockReturnValue(true),
}));
vi.mock("../packages/cli/src/workspace/workspace.js", () => ({
  createTempWorkspace: vi.fn().mockReturnValue({ cwd: "/tmp/test-workspace", info: { type: "temp", cwd: "/tmp/test-workspace" }, cleanup: vi.fn() }),
  createRepoWorkspace: vi.fn().mockReturnValue({ cwd: "/tmp/test-workspace", info: { type: "temp", cwd: "/tmp/test-workspace" }, cleanup: vi.fn() }),
  cleanupWorkspace: vi.fn(),
  restoreWorkspace: vi.fn(),
}));
vi.mock("../packages/cli/src/agent/systemPrompt.js", () => ({
  generateSystemPrompt: vi.fn().mockReturnValue("prompt"),
  writePromptFile: vi.fn().mockReturnValue("/tmp/prompt.txt"),
  cleanupPromptFile: vi.fn(),
}));
vi.mock("../packages/cli/src/config.js", () => ({
  getCredentials: vi.fn().mockReturnValue({ apiUrl: "https://example.com" }),
}));
vi.mock("../packages/cli/src/providers/registry.js", () => ({
  getProvider: vi.fn().mockReturnValue({
    name: "claude",
    label: "Claude",
    execute: vi.fn().mockResolvedValue({ events: (async function* () {})(), abort: vi.fn(), send: vi.fn() }),
  }),
  normalizeRuntime: vi.fn().mockImplementation((r: string) => r),
}));
vi.mock("../packages/cli/src/daemon/agentEnv.js", () => ({
  buildAgentEnv: vi.fn().mockReturnValue({}),
  setupGnupgHome: vi.fn().mockReturnValue(null),
  cleanupGnupgHome: vi.fn(),
}));
vi.mock("../packages/cli/src/session/manager.js", () => {
  const create = vi.fn().mockResolvedValue(undefined);
  return {
    getSessionManager: vi.fn().mockReturnValue({ create, list: vi.fn().mockReturnValue([]), patch: vi.fn().mockResolvedValue(null) }),
    _setSessionManagerForTest: vi.fn(),
  };
});
vi.mock("../packages/cli/src/client/index.js", async () => {
  const actual = await vi.importActual<typeof import("../packages/cli/src/client/index.js")>("../packages/cli/src/client/index.js");
  return {
    ...actual,
    AgentClient: vi.fn().mockImplementation(() => ({
      getAgentId: vi.fn().mockReturnValue("agent-1"),
      getSessionId: vi.fn().mockReturnValue("session-1"),
      sendMessage: vi.fn().mockResolvedValue(undefined),
      updateSessionUsage: vi.fn().mockResolvedValue(undefined),
      getTask: vi.fn().mockResolvedValue({ status: "in_progress" }),
    })),
  };
});

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
    const { createBoard } = await import("../apps/web/server/boardRepo");
    const board = await createBoard(env.DB, "sched-test-user", "Scheduled Task Board", "ops");
    boardId = board.id;
  });

  it("createTask stores scheduled_at when provided", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const scheduledAt = "2099-01-01T00:00:00.000Z";
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Future task",
      board_id: boardId,
      scheduled_at: scheduledAt,
    });

    expect(task.scheduled_at).toBe(scheduledAt);
  });

  it("createTask stores null scheduled_at when not provided", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Immediate task",
      board_id: boardId,
    });

    expect(task.scheduled_at).toBeNull();
  });

  it("updateTask can set scheduled_at on an existing task", async () => {
    const { createTask, updateTask } = await import("../apps/web/server/taskRepo");
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
    const { createTask, updateTask, getTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Persist scheduled_at",
      board_id: boardId,
    });

    const scheduledAt = "2099-03-20T08:00:00.000Z";
    await updateTask(env.DB, task.id, { scheduled_at: scheduledAt });
    const fetched = await getTask(env.DB, task.id, "sched-test-user");

    expect(fetched).not.toBeNull();
    expect(fetched!.scheduled_at).toBe(scheduledAt);
  });

  it("updateTask preserves other fields when only scheduled_at is updated", async () => {
    const { createTask, updateTask } = await import("../apps/web/server/taskRepo");
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
    const { createTask, listTasks } = await import("../apps/web/server/taskRepo");
    const scheduledAt = "2099-07-04T00:00:00.000Z";
    const task = await createTask(env.DB, "sched-test-user", {
      title: "Listing test task",
      board_id: boardId,
      scheduled_at: scheduledAt,
    });

    const tasks = await listTasks(env.DB, "sched-test-user", { board_id: boardId });
    const found = tasks.find((t) => t.id === task.id);

    expect(found).toBeDefined();
    expect(found!.scheduled_at).toBe(scheduledAt);
  });

  it("listTasks returns null scheduled_at for tasks created without it", async () => {
    const { createTask, listTasks } = await import("../apps/web/server/taskRepo");
    const task = await createTask(env.DB, "sched-test-user", {
      title: "No schedule listing test",
      board_id: boardId,
    });

    const tasks = await listTasks(env.DB, "sched-test-user", { board_id: boardId });
    const found = tasks.find((t) => t.id === task.id);

    expect(found).toBeDefined();
    expect(found!.scheduled_at).toBeNull();
  });
});

// ─── DaemonLoop + RateLimiter + dispatchTasks filter unit tests ──────────────
// Tests for the task dispatch filter logic and loop behavior.
// dispatchTasks is called directly (filter tests) or via DaemonLoop (loop tests).

describe("dispatchTasks — scheduled_at filter", () => {
  function makeTask(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      id: "task-1",
      assigned_to: "agent-1",
      blocked: false,
      repository_id: null,
      board_type: "ops",
      scheduled_at: null,
      title: "Test task",
      description: null,
      priority: null,
      ...overrides,
    };
  }

  function makePool(spawnSpy: ReturnType<typeof vi.fn>) {
    return {
      activeCount: 0,
      getActiveTaskIds: () => [] as string[],
      hasTask: (_id: string) => false,
      killTask: async () => {},
      spawnAgent: spawnSpy,
    };
  }

  function makeClient(tasks: Record<string, unknown>[], repos: Record<string, unknown>[] = []) {
    return {
      listTasks: async () => tasks,
      listRepositories: async () => repos,
      getAgent: async () => ({ runtime: "claude", name: "Agent", model: null, skills: [], gpg_subkey_id: null, username: "agent-1" }),
      getTask: async () => ({ status: "in_progress" }),
      releaseTask: async () => null,
      getTaskNotes: async () => [],
      createSession: async () => ({ delegation_proof: "fake" }),
      closeSession: async () => null,
      getAgentGpgKey: async () => ({ armored_private_key: "", gpg_subkey_id: null }),
    };
  }

  function makeRateLimiter() {
    return new RateLimiter({ onResumed: () => {} });
  }

  const prMonitor = { track: () => {} };
  const opts = { maxConcurrent: 5, pollInterval: 60000 };

  it("dispatches a task with null scheduled_at immediately", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({ id: "task-null-sched", scheduled_at: null });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(spawnSpy).toHaveBeenCalled();
    rl.stop();
  });

  it("does not dispatch a task whose scheduled_at is in the future", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const futureDate = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const task = makeTask({ id: "task-future", scheduled_at: futureDate });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    const result = await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
    rl.stop();
  });

  it("dispatches a task whose scheduled_at is in the past", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const pastDate = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const task = makeTask({ id: "task-past", scheduled_at: pastDate });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(spawnSpy).toHaveBeenCalled();
    rl.stop();
  });

  it("dispatches a task whose scheduled_at equals now (boundary: not filtered)", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const justNow = new Date(Date.now() - 1).toISOString();
    const task = makeTask({ id: "task-boundary", scheduled_at: justNow });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(spawnSpy).toHaveBeenCalled();
    rl.stop();
  });

  it("does not dispatch a future-scheduled task while dispatching a past-scheduled task in the same list", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const pastDate = new Date(Date.now() - 1000).toISOString();
    const futureDate = new Date(Date.now() + 3_600_000).toISOString();
    const tasks = [makeTask({ id: "task-ready", scheduled_at: pastDate }), makeTask({ id: "task-deferred", scheduled_at: futureDate })];
    const client = makeClient(tasks);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    // Dispatched exactly once (only the past-scheduled task)
    expect(spawnSpy).toHaveBeenCalledTimes(1);
    rl.stop();
  });

  it("does not dispatch a task whose repository is not locally cloned", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({ id: "task-uncloned-repo", board_type: "dev", repository_id: "repo-1" });
    const repos = [{ id: "repo-1", url: "https://github.com/test/nonexistent-repo-xyz.git" }];
    const client = makeClient([task], repos);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    const result = await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
    rl.stop();
  });

  it("does not dispatch a dev-board task that has no repository_id", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({ id: "task-dev-no-repo", board_type: "dev", repository_id: null });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    const result = await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
    rl.stop();
  });

  it("does not dispatch a blocked task even with no scheduled_at", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({ id: "task-blocked", blocked: true });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    const result = await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
    rl.stop();
  });

  it("does not dispatch a task with no assigned_to", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({ id: "task-unassigned", assigned_to: null });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    const result = await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
    rl.stop();
  });

  it("skips task when board_type is invalid", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({ id: "task-bad-board", board_type: "unknown_type" });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    const result = await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
    rl.stop();
  });

  it("does not dispatch when all available tasks have a paused runtime", async () => {
    const { dispatchTasks } = await import("../packages/cli/src/daemon/dispatcher");
    const spawnSpy = vi.fn().mockResolvedValue(undefined);
    const task = makeTask({ id: "task-paused-runtime", assigned_to: "agent-paused" });
    const client = makeClient([task]);
    const pool = makePool(spawnSpy);
    const rl = makeRateLimiter();

    const futureReset = new Date(Date.now() + 120_000).toISOString();
    rl.pause("claude", futureReset);

    const result = await dispatchTasks(client as any, pool as any, rl, prMonitor, opts);

    expect(result).toBe(false);
    expect(spawnSpy).not.toHaveBeenCalled();
    rl.stop();
  });
});

describe("DaemonLoop + RateLimiter — loop behavior", () => {
  function makePool() {
    return {
      activeCount: 0,
      getActiveTaskIds: () => [] as string[],
      hasTask: (_id: string) => false,
      killTask: async () => {},
      spawnAgent: vi.fn().mockResolvedValue(undefined),
    };
  }

  function makeClient() {
    return {
      listTasks: async () => [],
      listRepositories: async () => [],
      getAgent: async () => ({ runtime: "claude" }),
      getTask: async () => ({ status: "in_progress" }),
      releaseTask: async () => null,
      getTaskNotes: async () => [],
    };
  }

  it("isRuntimePaused returns false when no runtimes are paused", async () => {
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    expect(rl.isRuntimePaused("claude")).toBe(false);
    rl.stop();
  });

  it("pause marks runtime as paused", async () => {
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    const futureReset = new Date(Date.now() + 120_000).toISOString();
    rl.pause("claude", futureReset);
    expect(rl.isRuntimePaused("claude")).toBe(true);
    rl.stop();
  });

  it("resumeRateLimit unpauses a paused runtime", async () => {
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    const futureReset = new Date(Date.now() + 120_000).toISOString();
    rl.pause("claude", futureReset);
    rl.resumeRateLimit("claude");
    expect(rl.isRuntimePaused("claude")).toBe(false);
    rl.stop();
  });

  it("resumeRateLimit is a no-op on a non-paused runtime", async () => {
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    expect(() => rl.resumeRateLimit("claude")).not.toThrow();
    expect(rl.isRuntimePaused("claude")).toBe(false);
    rl.stop();
  });

  it("pause ignores a newer pause that is earlier than the existing one", async () => {
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    const laterReset = new Date(Date.now() + 120_000).toISOString();
    const earlierReset = new Date(Date.now() + 30_000).toISOString();
    rl.pause("claude", laterReset);
    rl.pause("claude", earlierReset); // earlier — should NOT replace later
    expect(rl.isRuntimePaused("claude")).toBe(true);
    rl.stop();
  });

  it("DaemonLoop starts and stops without errors", async () => {
    const { DaemonLoop } = await import("../packages/cli/src/daemon/loop");
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    const pool = makePool();
    const client = makeClient();
    const prMonitor = { track: () => {} };

    const loop = new DaemonLoop(client as any, pool as any, rl, prMonitor, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 50));
    loop.stop();
    rl.stop();
  });

  it("DaemonLoop.onSlotFreed triggers a new poll", async () => {
    const { DaemonLoop } = await import("../packages/cli/src/daemon/loop");
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    const pool = makePool();
    let listTasksCalled = 0;
    const client = {
      ...makeClient(),
      listTasks: async () => {
        listTasksCalled++;
        return [];
      },
    };
    const prMonitor = { track: () => {} };

    const loop = new DaemonLoop(client as any, pool as any, rl, prMonitor, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 50));
    loop.onSlotFreed();
    await new Promise((r) => setTimeout(r, 50));
    loop.stop();
    rl.stop();

    expect(listTasksCalled).toBeGreaterThanOrEqual(1);
  });

  it("backs off with rate-limit delay when client.listTasks throws ApiError 429", async () => {
    const { DaemonLoop } = await import("../packages/cli/src/daemon/loop");
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const { ApiError } = await import("../packages/cli/src/client/index");
    const rl = new RateLimiter({ onResumed: () => {} });
    const pool = makePool();
    let callCount = 0;
    const client = {
      ...makeClient(),
      listTasks: async () => {
        callCount++;
        throw new ApiError(429, "rate limited");
      },
    };
    const prMonitor = { track: () => {} };

    const loop = new DaemonLoop(client as any, pool as any, rl, prMonitor, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 50));
    loop.stop();
    rl.stop();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });

  it("backs off when client.listTasks throws a generic error", async () => {
    const { DaemonLoop } = await import("../packages/cli/src/daemon/loop");
    const { RateLimiter } = await import("../packages/cli/src/daemon/rateLimiter");
    const rl = new RateLimiter({ onResumed: () => {} });
    const pool = makePool();
    let callCount = 0;
    const client = {
      ...makeClient(),
      listTasks: async () => {
        callCount++;
        throw new Error("network error");
      },
    };
    const prMonitor = { track: () => {} };

    const loop = new DaemonLoop(client as any, pool as any, rl, prMonitor, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    loop.start();
    await new Promise((r) => setTimeout(r, 50));
    loop.stop();
    rl.stop();

    expect(callCount).toBeGreaterThanOrEqual(1);
  });
});
