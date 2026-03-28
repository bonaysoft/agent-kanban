// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAgent } from "./helpers/db";

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");

let db: D1Database;
let mf: Miniflare;

async function applyMigrations(db: D1Database) {
  const files = [
    "0001_initial.sql",
    "0002_rename_task_logs_to_task_notes.sql",
    "0003_agent_kind.sql",
    "0004_rename_task_notes_to_task_actions.sql",
    "0005_agent_runtime_required.sql",
    "0006_add_device_id.sql",
    "0007_task_seq.sql",
    "0010_board_type.sql",
    "0011_task_scheduled_at.sql",
    "0012_gpg_keys.sql",
    "0013_agent_identity.sql",
    "0014_agent_mailbox_token.sql",
    "0015_username_global_unique.sql",
  ];
  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf-8");
    for (const stmt of sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)) {
      await db.prepare(stmt).run();
    }
  }
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  db = await mf.getD1Database("DB");
  await applyMigrations(db);
});

afterAll(async () => {
  await mf.dispose();
});

describe("agent JSON field parsing (skills, handoff_to)", () => {
  const ownerId = "user-json-agent";
  let agentId: string;

  it("createAgent returns skills and handoff_to as arrays", async () => {
    const agent = await createTestAgent(db, ownerId, {
      name: "Test Agent",
      username: "test-agent",
      runtime: "claude",
      skills: ["trailofbits/skills@differential-review", "obra/superpowers@verification-before-completion"],
      handoff_to: ["quality-goalkeeper", "enduser"],
    });
    agentId = agent.id;

    expect(Array.isArray(agent.skills)).toBe(true);
    expect(agent.skills).toEqual(["trailofbits/skills@differential-review", "obra/superpowers@verification-before-completion"]);
    expect(Array.isArray(agent.handoff_to)).toBe(true);
    expect(agent.handoff_to).toEqual(["quality-goalkeeper", "enduser"]);
  });

  it("createAgent with null skills/handoff_to returns null", async () => {
    const agent = await createTestAgent(db, ownerId, { name: "Bare Agent", username: "bare-agent", runtime: "claude" });

    expect(agent.skills).toBeNull();
    expect(agent.handoff_to).toBeNull();
  });

  it("listAgents returns parsed arrays", async () => {
    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(db, ownerId);
    const agent = agents.find((a) => a.id === agentId)!;

    expect(Array.isArray(agent.skills)).toBe(true);
    expect(agent.skills).toEqual(["trailofbits/skills@differential-review", "obra/superpowers@verification-before-completion"]);
    expect(Array.isArray(agent.handoff_to)).toBe(true);
    expect(agent.handoff_to).toEqual(["quality-goalkeeper", "enduser"]);
  });

  it("listAgents returns email derived from username", async () => {
    const { listAgents } = await import("../apps/web/functions/api/agentRepo");
    const agents = await listAgents(db, ownerId);
    const agent = agents.find((a) => a.id === agentId)!;

    expect(agent.username).toBe("test-agent");
    expect(agent.email).toBe("test-agent@mails.agent-kanban.dev");
  });

  it("getAgent returns parsed arrays", async () => {
    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await getAgent(db, agentId, ownerId);

    expect(agent).toBeTruthy();
    expect(Array.isArray(agent!.skills)).toBe(true);
    expect(agent!.skills).toEqual(["trailofbits/skills@differential-review", "obra/superpowers@verification-before-completion"]);
    expect(Array.isArray(agent!.handoff_to)).toBe(true);
  });

  it("getAgent returns email derived from username", async () => {
    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await getAgent(db, agentId, ownerId);

    expect(agent).toBeTruthy();
    expect(agent!.username).toBe("test-agent");
    expect(agent!.email).toBe("test-agent@mails.agent-kanban.dev");
  });

  it("updateAgent accepts arrays and returns parsed arrays", async () => {
    const { updateAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await updateAgent(db, agentId, {
      skills: ["new/skill@code-review"],
      handoff_to: ["enduser"],
    });

    expect(agent).toBeTruthy();
    expect(Array.isArray(agent!.skills)).toBe(true);
    expect(agent!.skills).toEqual(["new/skill@code-review"]);
    expect(agent!.handoff_to).toEqual(["enduser"]);
  });

  it("updated values persist through getAgent", async () => {
    const { getAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await getAgent(db, agentId, ownerId);

    expect(agent!.skills).toEqual(["new/skill@code-review"]);
    expect(agent!.handoff_to).toEqual(["enduser"]);
  });
});
