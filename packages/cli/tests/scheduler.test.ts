// @vitest-environment node
/**
 * Unit tests for Scheduler — focused on paths that require mocked session store,
 * workspace ops, and repo ops, which cannot be exercised in the root test suite
 * without real filesystem access.
 *
 * The Scheduler uses SessionManager (singleton) which reads from SESSIONS_DIR.
 * We redirect SESSIONS_DIR to a temp dir so real session files work correctly.
 * Orphan detection is purely in-memory: pm.hasTask(taskId) returning false means
 * the session is orphaned — no pid check is performed on worker sessions.
 */

import { rmSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Redirect SESSIONS_DIR to a temp path BEFORE importing session code ────────
const { tmpRoot } = vi.hoisted(() => {
  const { mkdtempSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  return { tmpRoot: mkdtempSync(join(tmpdir(), "ak-sched-test-")) };
});

vi.mock("../src/paths.js", async (importOriginal) => {
  const mod = (await importOriginal()) as any;
  const { join } = await import("node:path");
  return {
    ...mod,
    SESSIONS_DIR: join(tmpRoot, "sessions"),
  };
});

// ── Logger mock ───────────────────────────────────────────────────────────────
vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ── workspace mock ────────────────────────────────────────────────────────────
vi.mock("../src/workspace/workspace.js", () => ({
  cleanupWorkspace: vi.fn(),
}));

// ── repoOps mock ──────────────────────────────────────────────────────────────
vi.mock("../src/workspace/repoOps.js", () => ({
  ensureCloned: vi.fn(),
  prepareRepo: vi.fn().mockReturnValue(true),
  repoDir: vi.fn().mockReturnValue(null),
}));

// ── skillManager mock ─────────────────────────────────────────────────────────
vi.mock("../src/workspace/skills.js", () => ({
  ensureLefthookTask: vi.fn().mockResolvedValue(false),
}));

// ── shared mock ───────────────────────────────────────────────────────────────
vi.mock("@agent-kanban/shared", () => ({
  isBoardType: vi.fn().mockReturnValue(true),
}));

// ─────────────────────────────────────────────────────────────────────────────

import { ApiError } from "../src/client/index.js";
import { Scheduler } from "../src/daemon/scheduler.js";
import { SessionManager, _setSessionManagerForTest } from "../src/session/manager.js";
import { writeSession } from "../src/session/store.js";
import type { SessionFile } from "../src/session/types.js";

// ── Session helpers ───────────────────────────────────────────────────────────

function makeWorkerSession(sessionId: string, taskId: string, status: SessionFile["status"] = "active", overrides: Partial<SessionFile> = {}): SessionFile {
  return {
    type: "worker",
    agentId: "agent-1",
    sessionId,
    runtime: "claude" as any,
    startedAt: Date.now(),
    apiUrl: "http://localhost",
    privateKeyJwk: { kty: "OKP" } as JsonWebKey,
    taskId,
    workspace: { type: "temp", cwd: "/tmp/x" },
    status,
    ...overrides,
  };
}

let sm: SessionManager;

beforeEach(() => {
  sm = new SessionManager();
  _setSessionManagerForTest(sm);
});

afterEach(() => {
  _setSessionManagerForTest(null);
  rmSync(join(tmpRoot, "sessions"), { recursive: true, force: true });
});

// ─────────────────────────────────────────────────────────────────────────────

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

    expect(() => scheduler.resumeRateLimit("claude")).not.toThrow();
    expect(scheduler.isRuntimePaused("claude")).toBe(false);
    scheduler.stop();
  });

  it("calls resumeSession for rate_limited sessions matching the runtime", async () => {
    // Write a real rate_limited session file so SessionManager.list() returns it
    writeSession(makeWorkerSession("sess-rl", "task-rl", "rate_limited", { runtime: "claude" as any }));

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

    expect(stubs.runner.resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-rl" }),
      "",
    );
    scheduler.stop();
  });

  it("does not call resumeSession for rate_limited sessions with a different runtime", async () => {
    // Write a rate_limited session for "gemini" runtime
    writeSession(makeWorkerSession("sess-rl-other", "task-rl-other", "rate_limited", { runtime: "gemini" as any }));

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
    writeSession(makeWorkerSession("sess-review", "task-review", "in_review"));

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

    expect(stubs.runner.resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-review" }),
      expect.stringContaining("needs rework"),
    );
  });

  it("removes session when task is done", async () => {
    writeSession(makeWorkerSession("sess-done", "task-done", "in_review", {
      workspace: { type: "temp", cwd: "/tmp/work", branch: "task-done" },
    }));

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "done" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    // State machine transitions in_review → task_cancelled → terminal → file removed
    expect(sm.read("sess-done")).toBeNull();
    expect(stubs.runner.resumeSession).not.toHaveBeenCalled();
  });

  it("removes session when task is cancelled", async () => {
    writeSession(makeWorkerSession("sess-cancelled", "task-cancelled", "in_review", {
      workspace: { type: "temp", cwd: "/tmp/work", branch: "task-cancelled" },
    }));

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "cancelled" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(sm.read("sess-cancelled")).toBeNull();
  });

  it("removes session and logs when task is not found (ApiError 404)", async () => {
    writeSession(makeWorkerSession("sess-notfound", "task-notfound", "in_review", {
      workspace: { type: "temp", cwd: "/tmp/work", branch: "task-notfound" },
    }));

    const stubs = makeStubs();
    stubs.client.getTask.mockRejectedValue(new ApiError(404, "not found"));

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(sm.read("sess-notfound")).toBeNull();
  });

  it("falls back to 'No reason provided' when no rejected note exists", async () => {
    writeSession(makeWorkerSession("sess-noreason", "task-noreason", "in_review"));

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

    expect(stubs.runner.resumeSession).toHaveBeenCalledWith(
      expect.objectContaining({ sessionId: "sess-noreason" }),
      expect.stringContaining("No reason provided"),
    );
  });
});

// ── tick — orphaned active session cleanup ────────────────────────────────────
// Orphan detection: session.status="active" + pm.hasTask(taskId)=false → orphan.
// No pid check is performed on worker sessions (pid removed from worker sessions).

describe("Scheduler tick — orphaned active session cleanup", () => {
  it("releases and cleans up an orphaned active session whose task is still viable", async () => {
    // Write a real "active" session — not held by ProcessManager (pm.hasTask returns false)
    writeSession(makeWorkerSession("sess-orphan", "task-orphan", "active", {
      workspace: { type: "temp", cwd: "/tmp/orphan", branch: "task-orphan" },
    }));

    const stubs = makeStubs();
    // pm.hasTask returns false (default) — this session is an orphan
    stubs.client.getTask.mockResolvedValue({ status: "in_progress" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(stubs.client.releaseTask).toHaveBeenCalledWith("task-orphan");
    // Session file must be gone after terminal cleanup
    expect(sm.read("sess-orphan")).toBeNull();
  });

  it("cleans up orphaned active session without releasing when task is done", async () => {
    writeSession(makeWorkerSession("sess-orphan-done", "task-orphan-done", "active", {
      workspace: { type: "temp", cwd: "/tmp/orphan-done", branch: "task-orphan-done" },
    }));

    const stubs = makeStubs();
    stubs.client.getTask.mockResolvedValue({ status: "done" });

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(sm.read("sess-orphan-done")).toBeNull();
    // releaseTask should NOT be called for done tasks
    expect(stubs.client.releaseTask).not.toHaveBeenCalled();
  });

  it("removes orphaned session when task is not found (ApiError 404)", async () => {
    writeSession(makeWorkerSession("sess-orphan-404", "task-orphan-404", "active", {
      workspace: { type: "temp", cwd: "/tmp/orphan-404", branch: "task-orphan-404" },
    }));

    const stubs = makeStubs();
    stubs.client.getTask.mockRejectedValue(new ApiError(404, "not found"));

    const scheduler = new Scheduler(stubs.client as any, stubs.pm as any, stubs.runner as any, stubs.prMonitor as any, {
      maxConcurrent: 5,
      pollInterval: 60000,
    });

    scheduler.start();
    await new Promise((r) => setTimeout(r, 100));
    scheduler.stop();

    expect(sm.read("sess-orphan-404")).toBeNull();
  });
});
