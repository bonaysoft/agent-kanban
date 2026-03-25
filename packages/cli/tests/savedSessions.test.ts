// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs to intercept all file I/O performed by savedSessions.ts.
// The module reads/writes a single JSON file (SAVED_SESSIONS_FILE).  We
// maintain an in-memory "disk" so each test starts with a clean state.
// ---------------------------------------------------------------------------

let _disk: string | null = null; // null == file does not exist

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((_path: string, _enc: string) => {
    if (_disk === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return _disk;
  }),
  writeFileSync: vi.fn((_path: string, data: string) => {
    _disk = data;
  }),
  // Other fs functions used by sessionPids.ts — not needed here but exported
  // so that any indirect import of node:fs in the test process doesn't break.
  unlinkSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

// Also mock the paths module so SAVED_SESSIONS_FILE is a stable, known value.
vi.mock("../src/paths.js", () => ({
  SAVED_SESSIONS_FILE: "/fake/saved-sessions.json",
  SESSION_PIDS_FILE: "/fake/session-pids.json",
  CONFIG_DIR: "/fake/config",
  DATA_DIR: "/fake/data",
  STATE_DIR: "/fake/state",
  LOGS_DIR: "/fake/logs",
  CONFIG_FILE: "/fake/config/config.json",
  PID_FILE: "/fake/state/daemon.pid",
  LINKS_FILE: "/fake/data/links.json",
  REPOS_DIR: "/fake/data/repos",
  WORKTREES_DIR: "/fake/data/worktrees",
  TRACKED_TASKS_FILE: "/fake/data/tracked-tasks.json",
  REVIEW_SESSIONS_FILE: "/fake/data/review-sessions.json",
}));

import { writeFileSync } from "node:fs";

import { loadSessions, removeSession, type SavedSession, type SessionStatus, saveSession, updateSessionStatus } from "../src/savedSessions.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSession(overrides: Partial<SavedSession> = {}): SavedSession {
  return {
    taskId: "task-1",
    sessionId: "session-1",
    cwd: "/workspace/task-1",
    repoDir: "/repos/my-repo",
    branchName: "task/task-1",
    agentId: "agent-abc",
    privateKeyJwk: { kty: "OKP", crv: "Ed25519", x: "abc", d: "def" },
    runtime: "claude-code",
    status: "active",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  _disk = null;
  vi.clearAllMocks();
});

afterEach(() => {
  _disk = null;
});

// ---------------------------------------------------------------------------
// loadSessions
// ---------------------------------------------------------------------------

describe("loadSessions", () => {
  it("returns empty array when no sessions file exists", () => {
    expect(loadSessions()).toEqual([]);
  });

  it("returns all sessions when no status filter is provided", () => {
    saveSession(makeSession({ taskId: "task-1", status: "active" }));
    saveSession(makeSession({ taskId: "task-2", sessionId: "session-2", status: "rate_limited" }));

    const all = loadSessions();
    expect(all).toHaveLength(2);
  });

  it("returns only sessions matching the given status filter", () => {
    saveSession(makeSession({ taskId: "task-1", status: "active" }));
    saveSession(makeSession({ taskId: "task-2", sessionId: "session-2", status: "rate_limited" }));
    saveSession(makeSession({ taskId: "task-3", sessionId: "session-3", status: "in_review" }));

    const active = loadSessions("active");
    expect(active).toHaveLength(1);
    expect(active[0].taskId).toBe("task-1");
  });

  it("returns empty array when filter matches no sessions", () => {
    saveSession(makeSession({ taskId: "task-1", status: "active" }));

    expect(loadSessions("in_review")).toEqual([]);
  });

  it("returns all sessions with status 'in_review' when filtered", () => {
    saveSession(makeSession({ taskId: "task-1", status: "in_review" }));
    saveSession(makeSession({ taskId: "task-2", sessionId: "session-2", status: "in_review" }));
    saveSession(makeSession({ taskId: "task-3", sessionId: "session-3", status: "active" }));

    const inReview = loadSessions("in_review");
    expect(inReview).toHaveLength(2);
  });

  it("returns all sessions matching 'rate_limited' status", () => {
    saveSession(makeSession({ taskId: "task-1", status: "rate_limited" }));
    saveSession(makeSession({ taskId: "task-2", sessionId: "session-2", status: "active" }));

    expect(loadSessions("rate_limited")).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// saveSession
// ---------------------------------------------------------------------------

describe("saveSession", () => {
  it("persists a new session so loadSessions returns it", () => {
    const session = makeSession();
    saveSession(session);

    const loaded = loadSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].taskId).toBe("task-1");
  });

  it("stores all fields of the session correctly", () => {
    const session = makeSession({ model: "claude-opus-4" });
    saveSession(session);

    const loaded = loadSessions()[0];
    expect(loaded.sessionId).toBe("session-1");
    expect(loaded.cwd).toBe("/workspace/task-1");
    expect(loaded.repoDir).toBe("/repos/my-repo");
    expect(loaded.branchName).toBe("task/task-1");
    expect(loaded.agentId).toBe("agent-abc");
    expect(loaded.runtime).toBe("claude-code");
    expect(loaded.model).toBe("claude-opus-4");
    expect(loaded.status).toBe("active");
  });

  it("replaces an existing session with the same taskId", () => {
    saveSession(makeSession({ sessionId: "session-old" }));
    saveSession(makeSession({ sessionId: "session-new" }));

    const all = loadSessions();
    expect(all).toHaveLength(1);
    expect(all[0].sessionId).toBe("session-new");
  });

  it("appends a new session when taskId is different", () => {
    saveSession(makeSession({ taskId: "task-1" }));
    saveSession(makeSession({ taskId: "task-2", sessionId: "session-2" }));

    expect(loadSessions()).toHaveLength(2);
  });

  it("saves a session with optional model field absent", () => {
    const session = makeSession();
    delete (session as any).model;
    saveSession(session);

    const loaded = loadSessions()[0];
    expect(loaded.model).toBeUndefined();
  });

  it("writes the sessions file on each save", () => {
    saveSession(makeSession());
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// updateSessionStatus
// ---------------------------------------------------------------------------

describe("updateSessionStatus", () => {
  it("changes the status of an existing session", () => {
    saveSession(makeSession({ status: "active" }));

    updateSessionStatus("task-1", "rate_limited");

    const session = loadSessions()[0];
    expect(session.status).toBe("rate_limited");
  });

  it("updates to in_review status correctly", () => {
    saveSession(makeSession({ status: "active" }));

    updateSessionStatus("task-1", "in_review");

    expect(loadSessions()[0].status).toBe("in_review");
  });

  it("does not throw when the taskId does not exist", () => {
    expect(() => updateSessionStatus("nonexistent-task", "active")).not.toThrow();
  });

  it("does not modify other sessions when updating one", () => {
    saveSession(makeSession({ taskId: "task-1", status: "active" }));
    saveSession(makeSession({ taskId: "task-2", sessionId: "session-2", status: "active" }));

    updateSessionStatus("task-1", "in_review");

    const task2 = loadSessions().find((s) => s.taskId === "task-2");
    expect(task2?.status).toBe("active");
  });

  it("does not write file when taskId is not found", () => {
    // No sessions saved — update on a missing task should not write
    updateSessionStatus("ghost-task", "in_review");
    expect(loadSessions()).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// removeSession
// ---------------------------------------------------------------------------

describe("removeSession", () => {
  it("removes a session by taskId", () => {
    saveSession(makeSession({ taskId: "task-1" }));

    removeSession("task-1");

    expect(loadSessions()).toHaveLength(0);
  });

  it("does not remove other sessions with different taskId", () => {
    saveSession(makeSession({ taskId: "task-1" }));
    saveSession(makeSession({ taskId: "task-2", sessionId: "session-2" }));

    removeSession("task-1");

    const remaining = loadSessions();
    expect(remaining).toHaveLength(1);
    expect(remaining[0].taskId).toBe("task-2");
  });

  it("does not throw when removing a non-existent taskId", () => {
    saveSession(makeSession({ taskId: "task-1" }));

    expect(() => removeSession("no-such-task")).not.toThrow();
  });

  it("does not throw when sessions file does not exist", () => {
    expect(() => removeSession("task-x")).not.toThrow();
  });

  it("leaves sessions list empty after removing the last session", () => {
    saveSession(makeSession({ taskId: "task-1" }));
    removeSession("task-1");

    expect(loadSessions()).toEqual([]);
  });

  it("is idempotent — removing the same taskId twice does not throw", () => {
    saveSession(makeSession({ taskId: "task-1" }));
    removeSession("task-1");
    expect(() => removeSession("task-1")).not.toThrow();
  });

  it("does not write file when taskId was not present in the list", () => {
    saveSession(makeSession({ taskId: "task-1" }));
    vi.clearAllMocks(); // reset write count after saveSession

    removeSession("task-99"); // not present
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SessionStatus type coverage — all three statuses are valid values
// ---------------------------------------------------------------------------

describe("SessionStatus valid values", () => {
  const statuses: SessionStatus[] = ["active", "rate_limited", "in_review"];

  for (const status of statuses) {
    it(`can save and reload a session with status '${status}'`, () => {
      saveSession(makeSession({ status }));
      const loaded = loadSessions(status);
      expect(loaded).toHaveLength(1);
      expect(loaded[0].status).toBe(status);
    });
  }
});
