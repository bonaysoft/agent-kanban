// @vitest-environment node
/**
 * Tests for the RATE_LIMIT_RESUME_PROMPT fix in loop.ts.
 *
 * Verifies that both resumeRateLimitedSessions and the private
 * resumeBackoffSessions pass a non-empty message string to resumeOneSession,
 * preventing the "cache_control cannot be set for empty text blocks" 400 error.
 *
 * RATE_LIMIT_RESUME_PROMPT is a module-private constant, so we verify it
 * indirectly by capturing the message argument received by resumeOneSession.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---- Capture calls to resumeOneSession before the module is imported --------
// vi.hoisted ensures the variable is available in the vi.mock factory (which
// is hoisted to the top of the file by Vitest's transformer).

const { resumeOneSessionMock } = vi.hoisted(() => ({
  resumeOneSessionMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../packages/cli/src/daemon/resumer.js", () => ({
  resumeOneSession: resumeOneSessionMock,
}));

// ---- Suppress path-related fs side effects ----------------------------------

vi.mock("../packages/cli/src/paths.js", () => {
  const { join } = require("node:path");
  const { tmpdir } = require("node:os");
  const base = join(tmpdir(), `ak-test-loop-prompt-${process.pid}`);
  return {
    STATE_DIR: base,
    CONFIG_DIR: base,
    DATA_DIR: base,
    LOGS_DIR: join(base, "logs"),
    CONFIG_FILE: join(base, "config.json"),
    PID_FILE: join(base, "daemon.pid"),
    DAEMON_STATE_FILE: join(base, "daemon-state.json"),
    REPOS_DIR: join(base, "repos"),
    WORKTREES_DIR: join(base, "worktrees"),
    SESSIONS_DIR: join(base, "sessions"),
    TRACKED_TASKS_FILE: join(base, "tracked-tasks.json"),
    IDENTITIES_DIR: join(base, "identities"),
    LEGACY_SAVED_SESSIONS_FILE: join(base, "saved-sessions.json"),
    LEGACY_SESSION_PIDS_FILE: join(base, "session-pids.json"),
  };
});

// ---- Suppress logger noise --------------------------------------------------

vi.mock("../packages/cli/src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

// ---- Imports after mocks are set up -----------------------------------------

import { DaemonLoop } from "../packages/cli/src/daemon/loop.js";
import type { SessionFile } from "../packages/cli/src/session/types.js";

// ---- Minimal fakes ----------------------------------------------------------

function makeRateLimitedSession(runtime: string, taskId = "task-1"): SessionFile {
  return {
    type: "worker",
    agentId: "agent-1",
    sessionId: "session-aaaaaaaa-1111-2222-3333-444444444444",
    runtime: runtime as any,
    startedAt: Date.now(),
    apiUrl: "http://localhost",
    privateKeyJwk: {} as any,
    taskId,
    status: "rate_limited",
    resumeAfter: undefined, // no future backoff — eligible for immediate resume
  };
}

function makePool(overrides: Partial<{ activeCount: number; hasTask: (id: string) => boolean }> = {}) {
  return {
    activeCount: overrides.activeCount ?? 0,
    hasTask: overrides.hasTask ?? ((_id: string) => false),
    getActiveTaskIds: () => [],
  } as any;
}

function makeRateLimiter() {
  return {} as any;
}

function makePrMonitor() {
  return {} as any;
}

function makeClient() {
  return {} as any;
}

function makeLoop(sessions: SessionFile[], poolOverrides = {}) {
  const pool = makePool(poolOverrides);

  // Wire a minimal session manager that returns our test sessions
  const sessionManager = {
    list: (filter: { type: string; status: string }) => {
      return sessions.filter((s) => s.type === filter.type && s.status === filter.status);
    },
    patch: vi.fn().mockResolvedValue(undefined),
  };

  const loop = new DaemonLoop(makeClient(), pool, makeRateLimiter(), makePrMonitor(), {
    maxConcurrent: 4,
    pollInterval: 1000,
  });

  // Replace the internal session manager with our fake
  (loop as any).sessions = sessionManager;

  // Set running=true so resumeRateLimitedSessions does not short-circuit.
  // We avoid calling loop.start() to prevent scheduling a real setTimeout.
  (loop as any).running = true;

  return { loop, pool };
}

// ---- Tests ------------------------------------------------------------------

describe("DaemonLoop — RATE_LIMIT_RESUME_PROMPT is non-empty", () => {
  beforeEach(() => {
    resumeOneSessionMock.mockClear();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("resumeRateLimitedSessions", () => {
    it("calls resumeOneSession with a non-empty message when a rate-limited session is eligible", async () => {
      const session = makeRateLimitedSession("claude");
      const { loop } = makeLoop([session]);

      await loop.resumeRateLimitedSessions("claude");

      expect(resumeOneSessionMock).toHaveBeenCalledTimes(1);
      const messageArg: string = resumeOneSessionMock.mock.calls[0][1];
      expect(typeof messageArg).toBe("string");
      expect(messageArg.length).toBeGreaterThan(0);
    });

    it("does not call resumeOneSession when the runtime does not match", async () => {
      const session = makeRateLimitedSession("other-runtime");
      const { loop } = makeLoop([session]);

      await loop.resumeRateLimitedSessions("claude");

      expect(resumeOneSessionMock).not.toHaveBeenCalled();
    });

    it("does not call resumeOneSession when the pool is at max capacity", async () => {
      const session = makeRateLimitedSession("claude");
      const { loop } = makeLoop([session], { activeCount: 4 });

      await loop.resumeRateLimitedSessions("claude");

      expect(resumeOneSessionMock).not.toHaveBeenCalled();
    });

    it("does not call resumeOneSession when the task is already in the pool", async () => {
      const session = makeRateLimitedSession("claude", "task-active");
      const { loop } = makeLoop([session], { hasTask: (id) => id === "task-active" });

      await loop.resumeRateLimitedSessions("claude");

      expect(resumeOneSessionMock).not.toHaveBeenCalled();
    });

    it("does not call resumeOneSession when resumeAfter is in the future", async () => {
      const session = makeRateLimitedSession("claude");
      session.resumeAfter = Date.now() + 60_000;
      const { loop } = makeLoop([session]);

      await loop.resumeRateLimitedSessions("claude");

      expect(resumeOneSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("resumeBackoffSessions (via tick)", () => {
    it("calls resumeOneSession with a non-empty message when a session's backoff has expired", async () => {
      const session = makeRateLimitedSession("claude");
      // resumeAfter in the past → backoff expired → eligible
      session.resumeAfter = Date.now() - 1000;
      const { loop } = makeLoop([session]);

      // resumeBackoffSessions is private; drive it through tick() via a
      // minimal tick invocation. We call the private method directly to
      // avoid wiring the full tick pipeline (dispatchTasks etc.)
      await (loop as any).resumeBackoffSessions();

      expect(resumeOneSessionMock).toHaveBeenCalledTimes(1);
      const messageArg: string = resumeOneSessionMock.mock.calls[0][1];
      expect(typeof messageArg).toBe("string");
      expect(messageArg.length).toBeGreaterThan(0);
    });

    it("does not call resumeOneSession when resumeAfter is absent (no backoff set)", async () => {
      const session = makeRateLimitedSession("claude");
      // resumeAfter is undefined → resumeBackoffSessions skips (no backoff to expire)
      session.resumeAfter = undefined;
      const { loop } = makeLoop([session]);

      await (loop as any).resumeBackoffSessions();

      expect(resumeOneSessionMock).not.toHaveBeenCalled();
    });

    it("does not call resumeOneSession when the pool is at max capacity", async () => {
      const session = makeRateLimitedSession("claude");
      session.resumeAfter = Date.now() - 1000;
      const { loop } = makeLoop([session], { activeCount: 4 });

      await (loop as any).resumeBackoffSessions();

      expect(resumeOneSessionMock).not.toHaveBeenCalled();
    });
  });

  describe("both callers pass the same non-empty prompt string", () => {
    it("resumeRateLimitedSessions and resumeBackoffSessions pass identical message text", async () => {
      // Call each function in isolation so call indices are unambiguous.
      const sessionA = makeRateLimitedSession("claude", "task-A");
      const { loop: loopA } = makeLoop([sessionA]);
      await loopA.resumeRateLimitedSessions("claude");
      const msgFromRateLimit: string = resumeOneSessionMock.mock.calls[0][1];

      resumeOneSessionMock.mockClear();

      const sessionB = makeRateLimitedSession("claude", "task-B");
      sessionB.resumeAfter = Date.now() - 1000;
      const { loop: loopB } = makeLoop([sessionB]);
      await (loopB as any).resumeBackoffSessions();
      const msgFromBackoff: string = resumeOneSessionMock.mock.calls[0][1];

      // Both callers must use the same non-empty constant
      expect(typeof msgFromRateLimit).toBe("string");
      expect(msgFromRateLimit.length).toBeGreaterThan(0);
      expect(msgFromBackoff).toBe(msgFromRateLimit);
    });
  });
});
