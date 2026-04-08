// @vitest-environment node

import type { Task } from "@agent-kanban/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ─── helpers ───────────────────────────────────────────────────────────────

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    board_id: "board-1",
    seq: 1,
    status: "todo",
    title: "Test task",
    description: null,
    repository_id: null,
    labels: null,
    priority: null,
    created_by: null,
    assigned_to: null,
    result: null,
    pr_url: null,
    input: null,
    created_from: null,
    scheduled_at: null,
    position: 1,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

// ─── parseDuration ─────────────────────────────────────────────────────────

describe("parseDuration", () => {
  let parseDuration: (input: string) => number;

  beforeEach(async () => {
    vi.resetModules();
    ({ parseDuration } = await import("../packages/cli/src/commands/wait.js"));
  });

  it('returns Infinity for "0"', () => {
    expect(parseDuration("0")).toBe(Number.POSITIVE_INFINITY);
  });

  it("parses milliseconds suffix ms", () => {
    expect(parseDuration("500ms")).toBe(500);
  });

  it("parses seconds suffix s", () => {
    expect(parseDuration("30s")).toBe(30_000);
  });

  it("parses minutes suffix m", () => {
    expect(parseDuration("15m")).toBe(900_000);
  });

  it("parses hours suffix h", () => {
    expect(parseDuration("2h")).toBe(7_200_000);
  });

  it("trims surrounding whitespace", () => {
    expect(parseDuration("  10s  ")).toBe(10_000);
  });

  it("parses single-millisecond value 1ms", () => {
    expect(parseDuration("1ms")).toBe(1);
  });

  it("parses large hour value 24h", () => {
    expect(parseDuration("24h")).toBe(86_400_000);
  });

  it("throws on empty string", () => {
    expect(() => parseDuration("")).toThrow("Invalid duration");
  });

  it("throws on bare number with no unit", () => {
    expect(() => parseDuration("30")).toThrow("Invalid duration");
  });

  it("throws on unknown unit", () => {
    expect(() => parseDuration("10d")).toThrow("Invalid duration");
  });

  it("throws on non-numeric prefix", () => {
    expect(() => parseDuration("Xm")).toThrow("Invalid duration");
  });
});

// ─── waitForTasks ──────────────────────────────────────────────────────────
//
// Multi-poll tests need a timeout just large enough to allow a few polls to
// complete, but small enough that the per-poll sleep = Math.min(5000, remaining)
// is very short. We use 200ms total so each sleep is at most 200ms per cycle,
// allowing 3 calls within real wall time without fake timers.

describe("waitForTasks", () => {
  let waitForTasks: (ids: string[], opts: { until: any; timeout: number }) => Promise<number>;

  // Fresh module registry per test so vi.doMock takes effect
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 immediately when task is already at target status", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        getTask: async (_id: string) => makeTask({ id: _id, status: "done" }),
      }),
    }));
    ({ waitForTasks } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForTasks(["task-1"], { until: "done", timeout: 5000 });
    expect(code).toBe(0);
  });

  it("returns 0 when task transitions from todo to done across polls", async () => {
    let callCount = 0;
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        getTask: async (_id: string) => {
          callCount++;
          // Poll 1 → todo (not done), poll 2 → done (terminates)
          if (callCount === 1) return makeTask({ id: _id, status: "todo" });
          return makeTask({ id: _id, status: "done" });
        },
      }),
    }));
    ({ waitForTasks } = await import("../packages/cli/src/commands/wait.js"));

    // 2 polls require 1 sleep ≤ remaining ≤ 200ms; resolves within 200ms wall time
    const code = await waitForTasks(["task-1"], { until: "done", timeout: 200 });
    expect(code).toBe(0);
    expect(callCount).toBeGreaterThanOrEqual(2);
  }, 30_000);

  it("returns 2 when a task is cancelled while waiting for done", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        getTask: async (_id: string) => makeTask({ id: _id, status: "cancelled" }),
      }),
    }));
    ({ waitForTasks } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForTasks(["task-1"], { until: "done", timeout: 5000 });
    expect(code).toBe(2);
  });

  it("returns 0 when waiting for cancelled and task is already cancelled", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        getTask: async (_id: string) => makeTask({ id: _id, status: "cancelled" }),
      }),
    }));
    ({ waitForTasks } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForTasks(["task-1"], { until: "cancelled", timeout: 5000 });
    expect(code).toBe(0);
  });

  it("returns 124 on timeout when task never reaches target", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        // Always returns in_progress, never done
        getTask: async (_id: string) => makeTask({ id: _id, status: "in_progress" }),
      }),
    }));
    ({ waitForTasks } = await import("../packages/cli/src/commands/wait.js"));

    // Tiny timeout: first poll runs, then deadline has passed → 124
    const code = await waitForTasks(["task-1"], { until: "done", timeout: 1 });
    expect(code).toBe(124);
  });

  it("returns 0 when all multiple tasks reach target", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        getTask: async (_id: string) => makeTask({ id: _id, status: "done" }),
      }),
    }));
    ({ waitForTasks } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForTasks(["task-1", "task-2", "task-3"], { until: "done", timeout: 5000 });
    expect(code).toBe(0);
  });

  it("returns 2 when one of many tasks is cancelled while waiting for done", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        getTask: async (_id: string) => {
          if (_id === "task-2") return makeTask({ id: _id, status: "cancelled" });
          return makeTask({ id: _id, status: "done" });
        },
      }),
    }));
    ({ waitForTasks } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForTasks(["task-1", "task-2", "task-3"], { until: "done", timeout: 5000 });
    expect(code).toBe(2);
  });
});

// ─── waitForBoard ──────────────────────────────────────────────────────────

describe("waitForBoard", () => {
  let waitForBoard: (boardId: string, opts: any) => Promise<number>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns 0 when all tasks are done (--until all-done)", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [makeTask({ id: "t1", status: "done" }), makeTask({ id: "t2", status: "cancelled" })],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForBoard("board-1", {
      until: "all-done",
      filter: undefined,
      label: undefined,
      includeCurrent: true,
      timeout: 5000,
    });
    expect(code).toBe(0);
  });

  it("returns 124 on timeout when tasks are never all done", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [makeTask({ id: "t1", status: "in_progress" })],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForBoard("board-1", {
      until: "all-done",
      filter: undefined,
      label: undefined,
      includeCurrent: false,
      timeout: 1,
    });
    expect(code).toBe(124);
  });

  it("returns 0 on first task entering in_review with --filter in_review (transition, not initial)", async () => {
    let callCount = 0;
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => {
          callCount++;
          if (callCount === 1) {
            // First snapshot: task is todo — not in_review, no match
            return [makeTask({ id: "t1", status: "todo" })];
          }
          // Second snapshot: task transitions to in_review — match
          return [makeTask({ id: "t1", status: "in_review" })];
        },
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    // 200ms total timeout → sleep per cycle is at most 200ms; resolves in 2 polls
    const code = await waitForBoard("board-1", {
      until: undefined,
      filter: ["in_review"],
      label: undefined,
      includeCurrent: false,
      timeout: 200,
    });
    expect(code).toBe(0);
  }, 30_000);

  it("does NOT exit on initial snapshot with in_review task when includeCurrent is false", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        // Always returns in_review — never a *transition* into it
        listTasks: async (_params: any) => [makeTask({ id: "t1", status: "in_review" })],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    // Should time out because the initial state never triggers a filtered event
    const code = await waitForBoard("board-1", {
      until: undefined,
      filter: ["in_review"],
      label: undefined,
      includeCurrent: false,
      timeout: 1,
    });
    expect(code).toBe(124);
  });

  it("exits 0 on initial snapshot with in_review task when includeCurrent is true", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [makeTask({ id: "t1", status: "in_review" })],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForBoard("board-1", {
      until: undefined,
      filter: ["in_review"],
      label: undefined,
      includeCurrent: true,
      timeout: 5000,
    });
    expect(code).toBe(0);
  });

  it("returns 0 on --until in_review when first snapshot already has in_review task", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [makeTask({ id: "t1", status: "in_review" }), makeTask({ id: "t2", status: "todo" })],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    // --until in_review means "any task is in_review" — predicate satisfied regardless of includeCurrent
    const code = await waitForBoard("board-1", {
      until: "in_review",
      filter: undefined,
      label: undefined,
      includeCurrent: false,
      timeout: 5000,
    });
    expect(code).toBe(0);
  });

  it("returns 0 with --until all-done when only done tasks present", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [makeTask({ id: "t1", status: "done" }), makeTask({ id: "t2", status: "done" })],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForBoard("board-1", {
      until: "all-done",
      filter: undefined,
      label: undefined,
      includeCurrent: false,
      timeout: 5000,
    });
    expect(code).toBe(0);
  });

  it("does not satisfy all-done predicate when task list is empty", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForBoard("board-1", {
      until: "all-done",
      filter: undefined,
      label: undefined,
      includeCurrent: false,
      timeout: 1,
    });
    // Empty list never satisfies "all-done" — should timeout
    expect(code).toBe(124);
  });

  it("returns 0 with --until all-in_progress once all tasks are in_progress", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [makeTask({ id: "t1", status: "in_progress" }), makeTask({ id: "t2", status: "in_progress" })],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForBoard("board-1", {
      until: "all-in_progress",
      filter: undefined,
      label: undefined,
      includeCurrent: false,
      timeout: 5000,
    });
    expect(code).toBe(0);
  });

  it("passes label and board_id params through to listTasks", async () => {
    let capturedParams: any;
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (params: any) => {
          capturedParams = params;
          return [makeTask({ id: "t1", status: "done" })];
        },
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    await waitForBoard("board-42", {
      until: "all-done",
      filter: undefined,
      label: "release",
      includeCurrent: false,
      timeout: 5000,
    });

    expect(capturedParams).toMatchObject({ board_id: "board-42", label: "release" });
  });

  it("throws on invalid all-<status> predicate value", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    await expect(
      waitForBoard("board-1", {
        until: "all-badstatus",
        filter: undefined,
        label: undefined,
        includeCurrent: false,
        timeout: 5000,
      }),
    ).rejects.toThrow("Invalid --until value");
  });

  it("throws on completely unrecognised predicate string", async () => {
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => [],
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    await expect(
      waitForBoard("board-1", {
        until: "not-a-valid-pred",
        filter: undefined,
        label: undefined,
        includeCurrent: false,
        timeout: 5000,
      }),
    ).rejects.toThrow("Invalid --until value");
  });

  it("returns 0 with first-match mode when a filtered transition occurs", async () => {
    let callCount = 0;
    vi.doMock("../packages/cli/src/agent/leader.js", () => ({
      createClient: async () => ({
        listTasks: async (_params: any) => {
          callCount++;
          if (callCount === 1) return [makeTask({ id: "t1", status: "todo" })];
          return [makeTask({ id: "t1", status: "done" })];
        },
      }),
    }));
    ({ waitForBoard } = await import("../packages/cli/src/commands/wait.js"));

    const code = await waitForBoard("board-1", {
      until: "first-match",
      filter: ["done"],
      label: undefined,
      includeCurrent: false,
      timeout: 200,
    });
    expect(code).toBe(0);
  }, 30_000);
});
