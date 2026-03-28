// @vitest-environment node
// Verify --kind, --handoff-to, --skills flags for create and update agent (v1.8.1)

import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAgent, setupMiniflare } from "./helpers/db";

let db: D1Database;
let mf: Miniflare;

beforeAll(async () => {
  ({ mf, db } = await setupMiniflare());
});

afterAll(async () => {
  await mf.dispose();
});

describe("create agent: --kind flag", () => {
  it("creates an agent with kind=leader", async () => {
    const agent = await createTestAgent(db, "owner-kind", {
      username: "test-leader",
      name: "Test Leader",
      runtime: "claude",
      role: "lead",
      kind: "leader",
    });

    expect(agent.kind).toBe("leader");
  });

  it("creates an agent with kind=worker (default)", async () => {
    const agent = await createTestAgent(db, "owner-kind", {
      username: "test-worker",
      name: "Test Worker",
      runtime: "claude",
    });

    expect(agent.kind).toBe("worker");
  });

  it("kind=leader persists through getAgent", async () => {
    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const created = await createTestAgent(db, "owner-kind2", {
      username: "test-leader-persist",
      name: "Test Leader Persist",
      runtime: "claude",
      kind: "leader",
    });

    const fetched = await getAgent(db, created.id, "owner-kind2");
    expect(fetched).toBeTruthy();
    expect(fetched!.kind).toBe("leader");
  });

  it("kind=leader appears in listAgents", async () => {
    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const created = await createTestAgent(db, "owner-kind3", {
      username: "test-leader-list",
      name: "Test Leader List",
      runtime: "claude",
      kind: "leader",
    });

    const agents = await listAgents(db, "owner-kind3");
    const found = agents.find((a) => a.id === created.id);
    expect(found).toBeTruthy();
    expect(found!.kind).toBe("leader");
  });
});

describe("create agent: --handoff-to flag", () => {
  it("creates an agent with handoff_to populated", async () => {
    const agent = await createTestAgent(db, "owner-handoff", {
      username: "test-handoff",
      name: "Test Handoff",
      runtime: "claude",
      role: "dev",
      handoff_to: ["leader-agent-id"],
    });

    expect(Array.isArray(agent.handoff_to)).toBe(true);
    expect(agent.handoff_to).toEqual(["leader-agent-id"]);
  });

  it("handoff_to with multiple ids is stored as array", async () => {
    const agent = await createTestAgent(db, "owner-handoff", {
      username: "test-handoff-multi",
      name: "Test Handoff Multi",
      runtime: "claude",
      handoff_to: ["agent-1", "agent-2"],
    });

    expect(agent.handoff_to).toHaveLength(2);
    expect(agent.handoff_to).toEqual(["agent-1", "agent-2"]);
  });
});

describe("create agent: --skills flag", () => {
  it("creates an agent with skills array populated", async () => {
    const agent = await createTestAgent(db, "owner-skills", {
      username: "test-skills",
      name: "Test Skills",
      runtime: "claude",
      role: "dev",
      skills: ["agent-kanban"],
    });

    expect(Array.isArray(agent.skills)).toBe(true);
    expect(agent.skills).toEqual(["agent-kanban"]);
  });

  it("multiple skills are stored as array", async () => {
    const agent = await createTestAgent(db, "owner-skills", {
      username: "test-skills-multi",
      name: "Test Skills Multi",
      runtime: "claude",
      skills: ["agent-kanban", "trailofbits/skills@differential-review"],
    });

    expect(agent.skills).toHaveLength(2);
    expect(agent.skills).toContain("agent-kanban");
    expect(agent.skills).toContain("trailofbits/skills@differential-review");
  });
});

describe("update agent: --kind, --handoff-to, --skills flags", () => {
  let agentId: string;

  beforeAll(async () => {
    const agent = await createTestAgent(db, "owner-update", {
      username: "test-update-target",
      name: "Test Update Target",
      runtime: "claude",
    });
    agentId = agent.id;
  });

  it("updates kind from worker to leader", async () => {
    const { updateAgent } = await import("../apps/web/functions/api/agentRepo");
    const updated = await updateAgent(db, agentId, { kind: "leader" });

    expect(updated).toBeTruthy();
    expect(updated!.kind).toBe("leader");
  });

  it("kind update persists through getAgent", async () => {
    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const fetched = await getAgent(db, agentId, "owner-update");

    expect(fetched!.kind).toBe("leader");
  });

  it("updates handoff_to via updateAgent", async () => {
    const { updateAgent } = await import("../apps/web/functions/api/agentRepo");
    const updated = await updateAgent(db, agentId, { handoff_to: ["some-leader-id"] });

    expect(updated).toBeTruthy();
    expect(updated!.handoff_to).toEqual(["some-leader-id"]);
  });

  it("updates skills via updateAgent", async () => {
    const { updateAgent } = await import("../apps/web/functions/api/agentRepo");
    const updated = await updateAgent(db, agentId, { skills: ["agent-kanban"] });

    expect(updated).toBeTruthy();
    expect(updated!.skills).toEqual(["agent-kanban"]);
  });

  it("updates kind back to worker", async () => {
    const { updateAgent } = await import("../apps/web/functions/api/agentRepo");
    const updated = await updateAgent(db, agentId, { kind: "worker" });

    expect(updated!.kind).toBe("worker");
  });

  it("all three fields persist together", async () => {
    const { updateAgent, getAgent } = await import("../apps/web/functions/api/agentRepo");
    await updateAgent(db, agentId, {
      kind: "leader",
      handoff_to: ["final-leader"],
      skills: ["agent-kanban", "browse"],
    });

    const fetched = await getAgent(db, agentId, "owner-update");
    expect(fetched!.kind).toBe("leader");
    expect(fetched!.handoff_to).toEqual(["final-leader"]);
    expect(fetched!.skills).toEqual(["agent-kanban", "browse"]);
  });
});
