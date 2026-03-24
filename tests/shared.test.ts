import { AGENT_STATUSES, PRIORITIES, STALE_TIMEOUT_MS, TASK_ACTIONS } from "@agent-kanban/shared";
import { describe, expect, it } from "vitest";

describe("shared constants", () => {
  it("TASK_ACTIONS includes all v2 actions", () => {
    expect(TASK_ACTIONS).toContain("assigned");
    expect(TASK_ACTIONS).toContain("released");
    expect(TASK_ACTIONS).toContain("timed_out");
  });

  it("AGENT_STATUSES has online, offline", () => {
    expect(AGENT_STATUSES).toEqual(["online", "offline"]);
  });

  it("STALE_TIMEOUT_MS is 2 hours", () => {
    expect(STALE_TIMEOUT_MS).toBe(7200000);
  });

  it("PRIORITIES has 4 levels", () => {
    expect(PRIORITIES).toHaveLength(4);
    expect(PRIORITIES).toContain("urgent");
  });
});
