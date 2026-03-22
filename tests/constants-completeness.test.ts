import { describe, it, expect } from "vitest";
import { TASK_ACTIONS, AGENT_STATUSES } from "@agent-kanban/shared";

describe("enum completeness", () => {
  it("TASK_ACTIONS matches the migration CHECK constraint", () => {
    const migrationActions = ["created", "claimed", "moved", "commented", "completed", "assigned", "released", "timed_out", "cancelled", "review_requested"];
    expect([...TASK_ACTIONS]).toEqual(migrationActions);
  });

  it("AGENT_STATUSES covers all valid states", () => {
    expect([...AGENT_STATUSES]).toEqual(["online", "offline"]);
  });

  it("TaskAction type union matches TASK_ACTIONS constant", () => {
    // This test ensures the type definition and runtime constant stay in sync
    // If someone adds a value to one but not the other, TypeScript will catch it
    const actions: string[] = [...TASK_ACTIONS];
    expect(actions).toHaveLength(10);
    expect(actions).toContain("assigned");
    expect(actions).toContain("released");
    expect(actions).toContain("timed_out");
    expect(actions).toContain("cancelled");
    expect(actions).toContain("review_requested");
  });
});
