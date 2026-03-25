// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ---------------------------------------------------------------------------
// Mock node:fs so sessionPids.ts never touches the real filesystem.
// We maintain a simple in-memory store that mirrors the JSON file.
// ---------------------------------------------------------------------------

// In-memory "disk": null == file does not exist
let _disk: string | null = null;

vi.mock("node:fs", () => ({
  readFileSync: vi.fn((_path: string, _enc: string) => {
    if (_disk === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    return _disk;
  }),
  writeFileSync: vi.fn((_path: string, data: string) => {
    _disk = data;
  }),
  unlinkSync: vi.fn(() => {
    if (_disk === null) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
    _disk = null;
  }),
  mkdirSync: vi.fn(),
}));

// Mock paths so the module resolves to stable, fake paths.
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

// Mock the logger so pino is not instantiated.
vi.mock("../src/logger.js", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import { writeFileSync } from "node:fs";

import { cleanupStale, clearAll, isProcessAlive, removePid, savePid } from "../src/sessionPids.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Minimal MachineClient stub. */
function makeClient(
  overrides: {
    listAgents?: () => Promise<unknown[]>;
    listSessions?: (agentId: string) => Promise<unknown[]>;
    closeSession?: (agentId: string, sessionId: string) => Promise<void>;
  } = {},
) {
  return {
    listAgents: vi.fn().mockResolvedValue([]),
    listSessions: vi.fn().mockResolvedValue([]),
    closeSession: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  } as any;
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
// savePid
// ---------------------------------------------------------------------------

describe("savePid", () => {
  it("stores a sessionId→pid mapping so isProcessAlive finds it", () => {
    savePid("session-a", process.pid);
    // The mapping exists; process.pid is alive so isProcessAlive returns true
    expect(isProcessAlive("session-a")).toBe(true);
  });

  it("overwrites the PID for the same sessionId", () => {
    // Save a dead PID first, then replace with the live one
    savePid("session-a", 99999999);
    savePid("session-a", process.pid);
    expect(isProcessAlive("session-a")).toBe(true);
  });

  it("stores multiple distinct sessionId→pid pairs independently", () => {
    savePid("session-a", process.pid);
    savePid("session-b", process.pid);

    expect(isProcessAlive("session-a")).toBe(true);
    expect(isProcessAlive("session-b")).toBe(true);
  });

  it("writes the pids file on each call", () => {
    savePid("session-a", process.pid);
    expect(writeFileSync).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// removePid
// ---------------------------------------------------------------------------

describe("removePid", () => {
  it("removes an existing sessionId so isProcessAlive returns false", () => {
    savePid("session-a", process.pid);
    removePid("session-a");
    expect(isProcessAlive("session-a")).toBe(false);
  });

  it("does not throw when removing a non-existent sessionId", () => {
    expect(() => removePid("ghost-session")).not.toThrow();
  });

  it("does not affect other sessions when removing one", () => {
    savePid("session-a", process.pid);
    savePid("session-b", process.pid);

    removePid("session-a");

    expect(isProcessAlive("session-b")).toBe(true);
  });

  it("is idempotent — removing the same sessionId twice does not throw", () => {
    savePid("session-a", process.pid);
    removePid("session-a");
    expect(() => removePid("session-a")).not.toThrow();
  });

  it("does not write the file when the sessionId was not present", () => {
    // No sessions; removing a missing key should not call writeFileSync
    vi.clearAllMocks();
    removePid("no-such-session");
    expect(writeFileSync).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// clearAll
// ---------------------------------------------------------------------------

describe("clearAll", () => {
  it("removes all pid mappings so isProcessAlive returns false for any session", () => {
    savePid("session-a", process.pid);

    clearAll();

    expect(isProcessAlive("session-a")).toBe(false);
  });

  it("does not throw when the pids file does not exist", () => {
    expect(() => clearAll()).not.toThrow();
  });

  it("is idempotent — calling clearAll twice does not throw", () => {
    savePid("session-a", process.pid);
    clearAll();
    expect(() => clearAll()).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// isProcessAlive
// ---------------------------------------------------------------------------

describe("isProcessAlive", () => {
  it("returns false when no PID is recorded for the sessionId", () => {
    expect(isProcessAlive("never-saved-session")).toBe(false);
  });

  it("returns true when the recorded PID is the current process", () => {
    savePid("session-live", process.pid);
    expect(isProcessAlive("session-live")).toBe(true);
  });

  it("returns false when the recorded PID is not an alive process", () => {
    // PID 99999999 is extremely unlikely to be alive on any OS
    savePid("session-dead", 99999999);
    expect(isProcessAlive("session-dead")).toBe(false);
  });

  it("returns false for all sessions after clearAll", () => {
    savePid("session-a", process.pid);
    savePid("session-b", process.pid);
    clearAll();

    expect(isProcessAlive("session-a")).toBe(false);
    expect(isProcessAlive("session-b")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// cleanupStale
// ---------------------------------------------------------------------------

describe("cleanupStale", () => {
  it("resolves without error when listAgents returns empty array", async () => {
    const client = makeClient({ listAgents: vi.fn().mockResolvedValue([]) });
    await expect(cleanupStale(client, "machine-1")).resolves.toBeUndefined();
  });

  it("does not call closeSession when no sessions exist for an agent", async () => {
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }]),
      listSessions: vi.fn().mockResolvedValue([]),
      closeSession,
    });

    await cleanupStale(client, "machine-1");

    expect(closeSession).not.toHaveBeenCalled();
  });

  it("skips a session that belongs to a different machine", async () => {
    savePid("session-other", process.pid);
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }]),
      listSessions: vi.fn().mockResolvedValue([{ id: "session-other", status: "active", machine_id: "machine-2" }]),
      closeSession,
    });

    await cleanupStale(client, "machine-1");

    expect(closeSession).not.toHaveBeenCalled();
  });

  it("skips a session whose status is not active", async () => {
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }]),
      listSessions: vi.fn().mockResolvedValue([{ id: "session-closed", status: "closed", machine_id: "machine-1" }]),
      closeSession,
    });

    await cleanupStale(client, "machine-1");

    expect(closeSession).not.toHaveBeenCalled();
  });

  it("closes an active session for the right machine when the process is not alive", async () => {
    // PID 99999999 will not be alive
    savePid("session-stale", 99999999);
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }]),
      listSessions: vi.fn().mockResolvedValue([{ id: "session-stale", status: "active", machine_id: "machine-1" }]),
      closeSession,
    });

    await cleanupStale(client, "machine-1");

    expect(closeSession).toHaveBeenCalledWith("agent-1", "session-stale");
  });

  it("does not close a session whose process is still alive", async () => {
    savePid("session-live", process.pid);
    const closeSession = vi.fn().mockResolvedValue(undefined);
    const client = makeClient({
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }]),
      listSessions: vi.fn().mockResolvedValue([{ id: "session-live", status: "active", machine_id: "machine-1" }]),
      closeSession,
    });

    await cleanupStale(client, "machine-1");

    expect(closeSession).not.toHaveBeenCalled();
  });

  it("does not throw when listAgents rejects", async () => {
    const client = makeClient({
      listAgents: vi.fn().mockRejectedValue(new Error("network error")),
    });

    await expect(cleanupStale(client, "machine-1")).resolves.toBeUndefined();
  });

  it("removes the stale sessionId from the local pids map after closing", async () => {
    savePid("session-stale", 99999999);
    const client = makeClient({
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }]),
      listSessions: vi.fn().mockResolvedValue([{ id: "session-stale", status: "active", machine_id: "machine-1" }]),
      closeSession: vi.fn().mockResolvedValue(undefined),
    });

    await cleanupStale(client, "machine-1");

    // After cleanup the stale session should no longer be tracked
    expect(isProcessAlive("session-stale")).toBe(false);
  });

  it("handles closeSession rejecting without throwing", async () => {
    savePid("session-stale", 99999999);
    const client = makeClient({
      listAgents: vi.fn().mockResolvedValue([{ id: "agent-1" }]),
      listSessions: vi.fn().mockResolvedValue([{ id: "session-stale", status: "active", machine_id: "machine-1" }]),
      closeSession: vi.fn().mockRejectedValue(new Error("close failed")),
    });

    // closeSession errors are swallowed via .catch(() => {})
    await expect(cleanupStale(client, "machine-1")).resolves.toBeUndefined();
  });
});
