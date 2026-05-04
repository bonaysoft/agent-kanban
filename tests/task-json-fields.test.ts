// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAgent, seedUser } from "./helpers/db";

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
    "0016_task_actions_session_id.sql",
    "0017_unique_leader_per_runtime.sql",
    "0018_agent_subagents.sql",
    "0019_agent_versions.sql",
    "0020_board_labels.sql",
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

describe("task JSON field parsing (labels, input)", () => {
  const ownerId = "user-json-task";
  let boardId: string;
  let taskId: string;

  it("setup: create board", async () => {
    await seedUser(db, ownerId, `${ownerId}@test.local`);
    const { createBoard } = await import("../apps/web/server/boardRepo");
    const board = await createBoard(db, ownerId, "json-test-board", "ops");
    boardId = board.id;
    await createBoard(db, ownerId, "json-empty-labels-board", "ops");
    await db
      .prepare("UPDATE boards SET labels = ? WHERE id = ?")
      .bind(
        JSON.stringify([
          { name: "bug", color: "#EF4444", description: "Bug fix" },
          { name: "urgent", color: "#EAB308", description: "Urgent work" },
          { name: "feature", color: "#22D3EE", description: "Feature work" },
        ]),
        boardId,
      )
      .run();
    const { updateMachine, upsertMachine } = await import("../apps/web/server/machineRepo");
    const machine = await upsertMachine(db, ownerId, {
      name: "json-runtime-machine",
      os: "darwin",
      version: "1.0.0",
      runtimes: [{ name: "claude", status: "ready", checked_at: "2026-03-21T10:00:00Z" }],
      device_id: "json-runtime-machine-device",
    });
    await updateMachine(db, machine.id, ownerId, {});
  });

  it("createTask returns labels as array and input as object", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(db, ownerId, {
      title: "Test labels and input",
      board_id: boardId,
      labels: ["bug", "urgent"],
      input: { prompt: "fix the thing", context: { file: "main.ts", line: 42 } },
    });
    taskId = task.id;

    expect(Array.isArray(task.labels)).toBe(true);
    expect(task.labels).toEqual(["bug", "urgent"]);
    expect(typeof task.input).toBe("object");
    expect(task.input).toEqual({ prompt: "fix the thing", context: { file: "main.ts", line: 42 } });
  });

  it("createTask rejects labels that are not defined on the board", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    await expect(
      createTask(db, ownerId, {
        title: "Unknown label",
        board_id: boardId,
        labels: ["missing"],
      }),
    ).rejects.toThrow("Label not found: missing");
  });

  it("createTask with null labels/input returns null", async () => {
    const { createTask } = await import("../apps/web/server/taskRepo");
    const task = await createTask(db, ownerId, {
      title: "Bare task",
      board_id: boardId,
    });

    expect(task.labels).toBeNull();
    expect(task.input).toBeNull();
  });

  it("listTasks returns parsed labels and input", async () => {
    const { listTasks } = await import("../apps/web/server/taskRepo");
    const tasks = await listTasks(db, ownerId, { board_id: boardId });
    const task = tasks.find((t) => t.id === taskId)!;

    expect(Array.isArray(task.labels)).toBe(true);
    expect(task.labels).toEqual(["bug", "urgent"]);
    expect(typeof task.input).toBe("object");
    expect(task.input!.prompt).toBe("fix the thing");
  });

  it("getTask returns parsed labels and input", async () => {
    const { getTask } = await import("../apps/web/server/taskRepo");
    const task = await getTask(db, taskId, ownerId);

    expect(task).toBeTruthy();
    expect(Array.isArray(task!.labels)).toBe(true);
    expect(task!.labels).toEqual(["bug", "urgent"]);
    expect(typeof task!.input).toBe("object");
    expect(task!.input!.context).toEqual({ file: "main.ts", line: 42 });
  });

  it("updateTask accepts arrays/objects and returns parsed values", async () => {
    const { updateTask } = await import("../apps/web/server/taskRepo");
    const task = await updateTask(db, taskId, {
      labels: ["feature"],
      input: { prompt: "new prompt" },
    });

    expect(task).toBeTruthy();
    expect(task!.labels).toEqual(["feature"]);
    expect(task!.input).toEqual({ prompt: "new prompt" });
  });

  it("updated values persist through getTask", async () => {
    const { getTask } = await import("../apps/web/server/taskRepo");
    const task = await getTask(db, taskId, ownerId);

    expect(task!.labels).toEqual(["feature"]);
    expect(task!.input).toEqual({ prompt: "new prompt" });
  });

  it("getBoard returns tasks with parsed labels and input", async () => {
    const { getBoard } = await import("../apps/web/server/boardRepo");
    const board = await getBoard(db, boardId);

    expect(board).toBeTruthy();
    const task = board!.tasks.find((t) => t.id === taskId)!;
    expect(Array.isArray(task.labels)).toBe(true);
    expect(task.labels).toEqual(["feature"]);
    expect(typeof task.input).toBe("object");
    expect(task.input).toEqual({ prompt: "new prompt" });
  });

  it("lifecycle functions preserve parsed JSON fields", async () => {
    const { assignTask, claimTask, reviewTask } = await import("../apps/web/server/taskRepo");

    const agent = await createTestAgent(db, ownerId, { name: "worker", username: "worker", runtime: "claude" });
    const assigned = await assignTask(db, taskId, agent.id, "machine", "system");
    expect(Array.isArray(assigned!.labels)).toBe(true);

    const claimed = await claimTask(db, taskId, agent.id, "agent:worker");
    expect(Array.isArray(claimed!.labels)).toBe(true);
    expect(typeof claimed!.input).toBe("object");

    const reviewed = await reviewTask(db, taskId, "agent:worker", agent.id, "https://github.com/pr/1", "agent:worker");
    expect(Array.isArray(reviewed!.labels)).toBe(true);
    expect(typeof reviewed!.input).toBe("object");
  });

  it("deleteBoardLabel removes the label from tasks on the same board", async () => {
    const { createTask, getTask } = await import("../apps/web/server/taskRepo");
    const { deleteBoardLabel } = await import("../apps/web/server/boardRepo");
    const task = await createTask(db, ownerId, {
      title: "Delete label propagation",
      board_id: boardId,
      labels: ["bug", "feature"],
    });

    const board = await deleteBoardLabel(db, boardId, "bug");
    const updated = await getTask(db, task.id, ownerId);

    expect(board!.labels.map((label) => label.name)).not.toContain("bug");
    expect(updated!.labels).toEqual(["feature"]);
  });
});
