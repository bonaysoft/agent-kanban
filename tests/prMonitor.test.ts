// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock child_process so getPrState never shells out
vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

// Mock pino logger so output goes through console with [LEVEL] prefixes
vi.mock("../packages/cli/src/logger.js", () => ({
  createLogger: () => ({
    info: (msg: string) => console.log(`[INFO] ${msg}`),
    warn: (msg: string) => console.log(`[WARN] ${msg}`),
    error: (msg: string) => console.error(`[ERROR] ${msg}`),
    debug: (msg: string) => console.log(`[DEBUG] ${msg}`),
    fatal: (msg: string) => console.error(`[FATAL] ${msg}`),
  }),
}));

// Mock fs so saveTrackedTasks/loadTrackedTasks never touches disk
vi.mock("fs", () => ({
  readFileSync: vi.fn().mockImplementation(() => {
    throw new Error("ENOENT");
  }),
  writeFileSync: vi.fn(),
  mkdirSync: vi.fn(),
}));

import { execSync } from "node:child_process";
import { PrMonitor } from "../packages/cli/src/prMonitor.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeExecSync(returnValue: string | Error) {
  if (returnValue instanceof Error) {
    vi.mocked(execSync).mockImplementation(() => {
      throw returnValue;
    });
  } else {
    vi.mocked(execSync).mockReturnValue(Buffer.from(`${returnValue}\n`) as any);
  }
}

function makeClient(
  overrides: Partial<{
    listTasks: () => Promise<unknown>;
    completeTask: () => Promise<unknown>;
    cancelTask: () => Promise<unknown>;
    getTask: () => Promise<unknown>;
  }> = {},
) {
  return {
    listTasks: vi.fn().mockResolvedValue([]),
    completeTask: vi.fn().mockResolvedValue({}),
    cancelTask: vi.fn().mockResolvedValue({}),
    getTask: vi.fn().mockResolvedValue(null),
    ...overrides,
  } as any;
}

/** Trigger one check() cycle by advancing fake timers. */
async function runCheck(monitor: PrMonitor) {
  // check() is private and called via setInterval. We call it through the
  // public track+start flow but bypass the timer by invoking the private
  // method directly via cast.
  await (monitor as any).check();
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

beforeEach(() => {
  vi.clearAllMocks();
  // Default: execSync throws so getPrState returns null
  vi.mocked(execSync).mockImplementation(() => {
    throw new Error("gh: not found");
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Consecutive failure counter (failureCount)
// ---------------------------------------------------------------------------

describe("PrMonitor — consecutive failure counter (failureCount)", () => {
  it("logs [WARN] on the first error from listTasks", async () => {
    const client = makeClient({
      listTasks: vi.fn().mockRejectedValue(new Error("network error")),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCheck(monitor);

    expect(spy).toHaveBeenCalledWith(expect.stringContaining("[WARN]"));
    spy.mockRestore();
  });

  it("does not log [ERROR] for failures below 10", async () => {
    const client = makeClient({
      listTasks: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 9; i++) {
      await runCheck(monitor);
    }

    const errorCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[ERROR]"));
    expect(errorCalls).toHaveLength(0);
    spy.mockRestore();
  });

  it("logs [ERROR] exactly at failure count 10", async () => {
    const client = makeClient({
      listTasks: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 10; i++) {
      await runCheck(monitor);
    }

    const errorCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[ERROR]"));
    expect(errorCalls).toHaveLength(1);
    expect(errorCalls[0][0]).toContain("10 consecutive");
    spy.mockRestore();
  });

  it("logs [ERROR] again at failure count 20 (every 10th after 10)", async () => {
    const client = makeClient({
      listTasks: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 20; i++) {
      await runCheck(monitor);
    }

    const errorCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[ERROR]"));
    // One at count=10, one at count=20
    expect(errorCalls).toHaveLength(2);
    spy.mockRestore();
  });

  it("does not log [ERROR] at count 11 (between multiples of 10)", async () => {
    const client = makeClient({
      listTasks: vi.fn().mockRejectedValue(new Error("fail")),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    for (let i = 0; i < 11; i++) {
      await runCheck(monitor);
    }

    const errorCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[ERROR]"));
    // Only one at count=10, not again at count=11
    expect(errorCalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("resets failureCount to 0 on a successful check", async () => {
    const client = makeClient({
      listTasks: vi.fn().mockRejectedValueOnce(new Error("fail")).mockRejectedValueOnce(new Error("fail")).mockResolvedValue([]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Two failures then a success
    await runCheck(monitor);
    await runCheck(monitor);
    await runCheck(monitor);

    // Now fail 9 more times — should NOT hit [ERROR] at count=10 because
    // the counter was reset
    for (let i = 0; i < 9; i++) {
      await runCheck(monitor);
    }

    const errorCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[ERROR]"));
    expect(errorCalls).toHaveLength(0);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Per-task failure tracking (taskFailures)
// ---------------------------------------------------------------------------

describe("PrMonitor — per-task failure tracking (taskFailures)", () => {
  it("does not warn for fewer than 20 consecutive getPrState failures on a task", async () => {
    makeExecSync(new Error("gh: not found"));

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    for (let i = 0; i < 19; i++) {
      await runCheck(monitor);
    }

    const warnCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[WARN]") && String(args[0]).includes("task-1"));
    expect(warnCalls).toHaveLength(0);
    spy.mockRestore();
  });

  it("logs [WARN] for a task at exactly 20 consecutive getPrState failures", async () => {
    makeExecSync(new Error("gh: not found"));

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    for (let i = 0; i < 20; i++) {
      await runCheck(monitor);
    }

    const warnCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[WARN]") && String(args[0]).includes("task-1"));
    expect(warnCalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("logs the [WARN] message only once, not on the 21st failure", async () => {
    makeExecSync(new Error("gh: not found"));

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    for (let i = 0; i < 21; i++) {
      await runCheck(monitor);
    }

    const warnCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[WARN]") && String(args[0]).includes("task-1"));
    expect(warnCalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("clears per-task failure count on successful getPrState (task stays OPEN)", async () => {
    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // 19 failures
    makeExecSync(new Error("fail"));
    for (let i = 0; i < 19; i++) {
      await runCheck(monitor);
    }

    // One success (OPEN) — resets the counter
    makeExecSync("OPEN");
    await runCheck(monitor);

    // 19 more failures — should NOT trigger the [WARN] because counter reset
    makeExecSync(new Error("fail"));
    for (let i = 0; i < 19; i++) {
      await runCheck(monitor);
    }

    const warnCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[WARN]") && String(args[0]).includes("task-1"));
    expect(warnCalls).toHaveLength(0);
    spy.mockRestore();
  });

  it("clears per-task failure count when task is untracked", async () => {
    makeExecSync(new Error("gh: not found"));

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    // 19 failures
    for (let i = 0; i < 19; i++) {
      await runCheck(monitor);
    }

    // Explicitly untrack — clears task failure count
    monitor.untrack("task-1");
    monitor.track("task-1");

    // 20 more failures — the counter restarted, so [WARN] fires once at 20
    for (let i = 0; i < 20; i++) {
      await runCheck(monitor);
    }

    const warnCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[WARN]") && String(args[0]).includes("task-1"));
    // Exactly one warn after the clean restart
    expect(warnCalls).toHaveLength(1);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Stuck task detection (tracked but not in API response)
// ---------------------------------------------------------------------------

describe("PrMonitor — stuck task detection", () => {
  it("untracks a task not present in the in_review API response", async () => {
    makeExecSync("OPEN");

    // listTasks returns an empty list — task-1 is tracked but not in_review
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCheck(monitor);

    const infoCalls = spy.mock.calls.filter((args) => String(args[0]).includes("[INFO]") && String(args[0]).includes("task-1"));
    expect(infoCalls).toHaveLength(1);
    spy.mockRestore();
  });

  it("logs [INFO] when untracking a stuck task", async () => {
    makeExecSync("OPEN");

    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-stuck");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCheck(monitor);

    const infoCall = spy.mock.calls.find((args) => String(args[0]).includes("[INFO]") && String(args[0]).includes("task-stuck"));
    expect(infoCall).toBeDefined();
    expect(String(infoCall![0])).toContain("untracking");
    spy.mockRestore();
  });

  it("does not untrack a task that is still in the in_review response", async () => {
    makeExecSync("OPEN");

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCheck(monitor);

    const untrackCalls = spy.mock.calls.filter((args) => String(args[0]).includes("no longer in_review"));
    expect(untrackCalls).toHaveLength(0);
    spy.mockRestore();
  });

  it("untracks multiple stuck tasks in a single check", async () => {
    makeExecSync("OPEN");

    // API returns only task-3 as in_review; task-1 and task-2 are done/cancelled
    const task3 = { id: "task-3", pr_url: "https://github.com/org/repo/pull/3", assigned_to: null };
    const listTasks = vi.fn().mockResolvedValue([task3]); // only in_review call now
    const getTask = vi
      .fn()
      .mockResolvedValueOnce({ status: "done" }) // task-1 is done → untrack
      .mockResolvedValueOnce({ status: "cancelled" }); // task-2 is cancelled → untrack
    const client = makeClient({ listTasks, getTask });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");
    monitor.track("task-2");
    monitor.track("task-3");

    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    await runCheck(monitor);

    const untrackCalls = spy.mock.calls.filter((args) => String(args[0]).includes("untracking"));
    expect(untrackCalls).toHaveLength(2);
    spy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// Happy path — MERGED and CLOSED PR states
// ---------------------------------------------------------------------------

describe("PrMonitor — PR state transitions", () => {
  it("calls completeTask when PR state is MERGED", async () => {
    makeExecSync("MERGED");

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const completeTask = vi.fn().mockResolvedValue({});
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
      completeTask,
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    await runCheck(monitor);

    expect(completeTask).toHaveBeenCalledWith("task-1", { result: "PR merged" });
  });

  it("calls cancelTask when PR state is CLOSED", async () => {
    makeExecSync("CLOSED");

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const cancelTask = vi.fn().mockResolvedValue({});
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
      cancelTask,
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    await runCheck(monitor);

    expect(cancelTask).toHaveBeenCalledWith("task-1");
  });

  it("does not call completeTask or cancelTask when PR state is OPEN", async () => {
    makeExecSync("OPEN");

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const completeTask = vi.fn().mockResolvedValue({});
    const cancelTask = vi.fn().mockResolvedValue({});
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
      completeTask,
      cancelTask,
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    await runCheck(monitor);

    expect(completeTask).not.toHaveBeenCalled();
    expect(cancelTask).not.toHaveBeenCalled();
  });

  it("untracks the task after a MERGED PR", async () => {
    makeExecSync("MERGED");

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    await runCheck(monitor);

    expect((monitor as any).trackedTasks.has("task-1")).toBe(false);
  });

  it("untracks the task after a CLOSED PR", async () => {
    makeExecSync("CLOSED");

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null };
    const client = makeClient({
      listTasks: vi.fn().mockResolvedValue([task]),
    });
    const monitor = new PrMonitor(client);
    monitor.track("task-1");

    await runCheck(monitor);

    expect((monitor as any).trackedTasks.has("task-1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Guard: skip check when nothing is tracked or already running
// ---------------------------------------------------------------------------

describe("PrMonitor — check guard conditions", () => {
  it("does not call listTasks when no tasks are tracked", async () => {
    const listTasks = vi.fn().mockResolvedValue([]);
    const monitor = new PrMonitor(makeClient({ listTasks }));

    await runCheck(monitor);

    expect(listTasks).not.toHaveBeenCalled();
  });

  it("does not call listTasks on a concurrent overlapping check", async () => {
    makeExecSync("OPEN");

    const task = { id: "task-1", pr_url: "https://github.com/org/repo/pull/1", assigned_to: null, status: "in_review" };
    // listTasks resolves on the next tick to allow overlap simulation
    let resolveFirst!: () => void;
    const firstCall = new Promise<any[]>((res) => {
      resolveFirst = () => res([task]);
    });
    // check() now calls listTasks once per run (only for in_review)
    const listTasks = vi.fn().mockReturnValueOnce(firstCall).mockResolvedValue([task]);

    const monitor = new PrMonitor(makeClient({ listTasks }));
    monitor.track("task-1");

    // Start first check but don't await yet
    const first = runCheck(monitor);
    // Start second check while first is still in flight
    const second = runCheck(monitor);

    resolveFirst();
    await Promise.all([first, second]);

    // check() calls listTasks once per run; second check should be skipped entirely
    expect(listTasks).toHaveBeenCalledTimes(1);
  });
});
