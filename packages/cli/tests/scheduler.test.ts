// @vitest-environment node
/**
 * Unit tests for Scheduler — focused on paths that require mocked session store,
 * workspace ops, and repo ops, which cannot be exercised in the root test suite
 * without real filesystem access.
 */

import { describe, expect, it, vi } from "vitest";

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── sessionStore mock ─────────────────────────────────────────────────────────
vi.mock("../src/sessionStore.js", () => ({
  listSessions: vi.fn().mockReturnValue([]),
  isPidAlive: vi.fn().mockReturnValue(false),
  removeSession: vi.fn(),
  updateSession: vi.fn(),
}));

// ── workspace mock ────────────────────────────────────────────────────────────
vi.mock("../src/workspace.js", () => ({
  cleanupWorkspace: vi.fn(),
}));

// ── repoOps mock ──────────────────────────────────────────────────────────────
vi.mock("../src/repoOps.js", () => ({
  ensureCloned: vi.fn(),
  prepareRepo: vi.fn().mockReturnValue(true),
  repoDir: vi.fn().mockReturnValue(null),
}));

// ── skillManager mock ─────────────────────────────────────────────────────────
vi.mock("../src/skillManager.js", () => ({
  ensureLefthookTask: vi.fn().mockResolvedValue(false),
}));

// ── shared mock ───────────────────────────────────────────────────────────────
vi.mock("@agent-kanban/shared", () => ({
  isBoardType: vi.fn().mockReturnValue(true),
}));

// ─────────────────────────────────────────────────────────────────────────────

import { ApiError } from "../src/client.js";
import { Scheduler } from "../src/scheduler.js";
import { isPidAlive, listSessions, removeSession } from "../src/sessionStore.js";

const mockListSessions = vi.mocked(listSessions);
const mockIsPidAlive = vi.mocked(isPidAlive);
const mockRemoveSession = vi.mocked(removeSession);

function makeStubs(tasks: Record<string, unknown>[] = []) {
  const client = {
    listTasks: vi.fn().mockResolvedValue(tasks),
    listRepositories: vi.fn().mockResolvedValue([]),
    getAgent: vi.fn().mockResolvedValue({ runtime: "claude" }),
    getTask: vi.fn().mockResolvedValue({ status: "in_progress" }),
    releaseTask: vi.fn().mockResolvedValue(undefined),
    getTaskNotes: vi.fn().mockResolvedValue([]),
  };
  const pm = {
    activeCount: 0,
    getActiveTaskIds: vi.fn().mockReturnValue([]),
    hasTask: vi.fn().mockReturnValue(false),
    killTask: vi.fn().mockResolvedValue(undefined),
  };
  const runner = {
    dispatch: vi.fn().mockResolvedValue(false),
    resumeSession: vi.fn().mockResolvedValue(undefined),
  };
  const prMonitor = {
    track: vi.fn(),
  };
  return { client, pm, runner, prMonitor };
}

function makeScheduler(stubs = makeStubs()) {
  return {
    ...stubs,
    scheduler: new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    }),
  };
}

// ── resumeRateLimit ───────────────────────────────────────────────────────────

describe("Scheduler.resumeRateLimit()", () => {
  it("unpauses a paused runtime after being started", async () => {
    mockListSessions.mockReturnValue([]);

    const { scheduler } = makeScheduler();
    scheduler.start();

    const futureReset = new Date(Date.now() + 120_000).toISOString();
    scheduler.pauseForRateLimit("claude", futureReset);
    expect(scheduler.isRuntimePaused("claude")).toBe(true);

    scheduler.resumeRateLimit("claude");
    await new Promise((r) => setTimeout(r, 50));

    expect(scheduler.isRuntimePaused("claude")).toBe(false);
    scheduler.stop();
  });

  it("is a no-op when the runtime is not paused", async () => {
    const { scheduler } = makeScheduler();
    scheduler.start();

    // Should not throw
    expect(() => scheduler.resumeRateLimit("claude")).not.toThrow();
    expect(scheduler.isRuntimePaused("claude")).toBe(false);
    scheduler.stop();
  });

  it("calls resumeSession for rate_limited sessions matching the runtime", async () => {
    const session = {
      type: "worker",
      status: "rate_limited",
      sessionId: "sess-rl",
      taskId: "task-rl",
      runtime: "claude",
      pid: 0,
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "rate_limited") return [session];
      return [];
    });

    const stubs = makeStubs();
    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    const futureReset = new Date(Date.now() + 120_000).toISOString();
    scheduler.pauseForRateLimit("claude", futureReset);
    scheduler.resumeRateLimit("claude");

    await new Promise((r) => setTimeout(r, 50));

    expect(stubs.runner.resumeSession).toHaveBeenCalledWith(session, "");
    scheduler.stop();
  });

  it("does not call resumeSession for rate_limited sessions with a different runtime", async () => {
    const session = {
      type: "worker",
      status: "rate_limited",
      sessionId: "sess-rl-other",
      taskId: "task-rl-other",
      runtime: "gemini",
      pid: 0,
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "rate_limited") return [session];
      return [];
    });

    const stubs = makeStubs();
    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    const futureReset = new Date(Date.now() + 120_000).toISOString();
    scheduler.pauseForRateLimit("claude", futureReset);
    scheduler.resumeRateLimit("claude");

    await new Promise((r) => setTimeout(r, 50));

    // session is for "gemini" not "claude" — should not be resumed
    expect(stubs.runner.resumeSession).not.toHaveBeenCalled();
    scheduler.stop();
  });
});

// ── tick — resumeSavedSessions for in_review sessions ────────────────────────

describe("Scheduler tick — in_review session resumption", () => {
  it("calls runner.resumeSession for an in_review session whose task is in_progress and rejected", async () => {
    const session = {
      type: "worker",
      status: "in_review",
      sessionId: "sess-review",
      taskId: "task-review",
      runtime: "claude",
      pid: 0,
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "in_review") return [session];
      return [];
    });

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "in_progress" });
    stubs.client.getTaskNotes.mockResolvedValue([{ action: "rejected", detail: "needs rework" }]);

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(stubs.runner.resumeSession).toHaveBeenCalledWith(session, expect.stringContaining("needs rework"));
  });

  it("removes session when task is done", async () => {
    const session = {
      type: "worker",
      status: "in_review",
      sessionId: "sess-done",
      taskId: "task-done",
      runtime: "claude",
      pid: 0,
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "in_review") return [session];
      return [];
    });

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "done" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(mockRemoveSession).toHaveBeenCalledWith("sess-done");
    expect(stubs.runner.resumeSession).not.toHaveBeenCalled();
  });

  it("removes session when task is cancelled", async () => {
    const session = {
      type: "worker",
      status: "in_review",
      sessionId: "sess-cancelled",
      taskId: "task-cancelled",
      runtime: "claude",
      pid: 0,
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "in_review") return [session];
      return [];
    });

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "cancelled" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(mockRemoveSession).toHaveBeenCalledWith("sess-cancelled");
  });

  it("removes session and logs when task is not found (ApiError 404)", async () => {
    const session = {
      type: "worker",
      status: "in_review",
      sessionId: "sess-notfound",
      taskId: "task-notfound",
      runtime: "claude",
      pid: 0,
      workspace: { dir: "/tmp/work", branch: "task-notfound" },
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "in_review") return [session];
      return [];
    });

    const stubs = makeStubs();
    stubs.client.getTask.mockRejectedValue(new ApiError(404, "not found"));

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(mockRemoveSession).toHaveBeenCalledWith("sess-notfound");
  });

  it("falls back to 'No reason provided' when no rejected note exists", async () => {
    const session = {
      type: "worker",
      status: "in_review",
      sessionId: "sess-noreason",
      taskId: "task-noreason",
      runtime: "claude",
      pid: 0,
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "in_review") return [session];
      return [];
    });

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "in_progress" });
    stubs.client.getTaskNotes.mockResolvedValue([]);

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(stubs.runner.resumeSession).toHaveBeenCalledWith(session, expect.stringContaining("No reason provided"));
  });
});

// ── tick — orphaned active session cleanup ────────────────────────────────────

describe("Scheduler tick — orphaned active session cleanup", () => {
  it("releases and cleans up an orphaned active session whose task is still viable", async () => {
    const session = {
      type: "worker",
      status: "active",
      sessionId: "sess-orphan",
      taskId: "task-orphan",
      runtime: "claude",
      pid: 0,
      workspace: { dir: "/tmp/orphan", branch: "task-orphan" },
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "active") return [session];
      return [];
    });
    mockIsPidAlive.mockReturnValue(false);

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "in_progress" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(stubs.client.releaseTask).toHaveBeenCalledWith("task-orphan");
    expect(mockRemoveSession).toHaveBeenCalledWith("sess-orphan");
  });

  it("cleans up orphaned active session without releasing when task is done", async () => {
    const session = {
      type: "worker",
      status: "active",
      sessionId: "sess-orphan-done",
      taskId: "task-orphan-done",
      runtime: "claude",
      pid: 0,
      workspace: { dir: "/tmp/orphan-done", branch: "task-orphan-done" },
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "active") return [session];
      return [];
    });
    mockIsPidAlive.mockReturnValue(false);

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "done" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(mockRemoveSession).toHaveBeenCalledWith("sess-orphan-done");
    // releaseTask should NOT be called for done tasks
    expect(stubs.client.releaseTask).not.toHaveBeenCalled();
  });

  it("removes orphaned session when task is not found (ApiError 404)", async () => {
    const session = {
      type: "worker",
      status: "active",
      sessionId: "sess-orphan-404",
      taskId: "task-orphan-404",
      runtime: "claude",
      pid: 0,
      workspace: { dir: "/tmp/orphan-404", branch: "task-orphan-404" },
    };

    mockListSessions.mockImplementation((filter: any) => {
      if (filter?.status === "active") return [session];
      return [];
    });
    mockIsPidAlive.mockReturnValue(false);

    const stubs = makeStubs();
    stubs.client.getTask.mockRejectedValue(new ApiError(404, "not found"));

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(mockRemoveSession).toHaveBeenCalledWith("sess-orphan-404");
  });
});
