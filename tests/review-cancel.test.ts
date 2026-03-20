import { describe, it, expect } from "vitest";
import {
  DEFAULT_COLUMNS,
  TASK_ACTIONS,
} from "@agent-kanban/shared";

describe("review and cancel columns", () => {
  it("DEFAULT_COLUMNS includes 'In Review' at position 2", () => {
    expect(DEFAULT_COLUMNS[2]).toBe("In Review");
  });

  it("DEFAULT_COLUMNS includes 'Cancelled' at position 4", () => {
    expect(DEFAULT_COLUMNS[4]).toBe("Cancelled");
  });

  it("DEFAULT_COLUMNS has the full ordered list", () => {
    expect([...DEFAULT_COLUMNS]).toEqual([
      "Todo",
      "In Progress",
      "In Review",
      "Done",
      "Cancelled",
    ]);
  });

  it("'In Review' comes after 'In Progress' and before 'Done'", () => {
    const inProgress = DEFAULT_COLUMNS.indexOf("In Progress");
    const inReview = DEFAULT_COLUMNS.indexOf("In Review");
    const done = DEFAULT_COLUMNS.indexOf("Done");
    expect(inReview).toBe(inProgress + 1);
    expect(inReview).toBe(done - 1);
  });

  it("'Cancelled' is the last column", () => {
    expect(DEFAULT_COLUMNS[DEFAULT_COLUMNS.length - 1]).toBe("Cancelled");
  });
});

describe("review and cancel task actions", () => {
  it("TASK_ACTIONS includes 'cancelled'", () => {
    expect(TASK_ACTIONS).toContain("cancelled");
  });

  it("TASK_ACTIONS includes 'review_requested'", () => {
    expect(TASK_ACTIONS).toContain("review_requested");
  });

  it("'cancelled' and 'review_requested' are the last two actions", () => {
    const len = TASK_ACTIONS.length;
    expect(TASK_ACTIONS[len - 2]).toBe("cancelled");
    expect(TASK_ACTIONS[len - 1]).toBe("review_requested");
  });

  it("TASK_ACTIONS has exactly 10 entries with new actions", () => {
    expect(TASK_ACTIONS).toHaveLength(10);
  });

  it("new actions coexist with all original actions", () => {
    const originals = [
      "created",
      "claimed",
      "moved",
      "commented",
      "completed",
      "assigned",
      "released",
      "timed_out",
    ] as const;
    for (const action of originals) {
      expect(TASK_ACTIONS).toContain(action);
    }
  });
});
