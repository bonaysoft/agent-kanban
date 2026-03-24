// @vitest-environment node

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");

let db: D1Database;
let mf: Miniflare;

async function applyMigrations(db: D1Database) {
  const files = ["0001_initial.sql"];
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
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(db, ownerId, "json-test-board");
    boardId = board.id;
  });

  it("createTask returns labels as array and input as object", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
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

  it("createTask with null labels/input returns null", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(db, ownerId, {
      title: "Bare task",
      board_id: boardId,
    });

    expect(task.labels).toBeNull();
    expect(task.input).toBeNull();
  });

  it("listTasks returns parsed labels and input", async () => {
    const { listTasks } = await import("../apps/web/functions/api/taskRepo");
    const tasks = await listTasks(db, { board_id: boardId });
    const task = tasks.find((t) => t.id === taskId)!;

    expect(Array.isArray(task.labels)).toBe(true);
    expect(task.labels).toEqual(["bug", "urgent"]);
    expect(typeof task.input).toBe("object");
    expect(task.input!.prompt).toBe("fix the thing");
  });

  it("getTask returns parsed labels and input", async () => {
    const { getTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await getTask(db, taskId);

    expect(task).toBeTruthy();
    expect(Array.isArray(task!.labels)).toBe(true);
    expect(task!.labels).toEqual(["bug", "urgent"]);
    expect(typeof task!.input).toBe("object");
    expect(task!.input!.context).toEqual({ file: "main.ts", line: 42 });
  });

  it("updateTask accepts arrays/objects and returns parsed values", async () => {
    const { updateTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await updateTask(db, taskId, {
      labels: ["feature"],
      input: { prompt: "new prompt" },
    });

    expect(task).toBeTruthy();
    expect(task!.labels).toEqual(["feature"]);
    expect(task!.input).toEqual({ prompt: "new prompt" });
  });

  it("updated values persist through getTask", async () => {
    const { getTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await getTask(db, taskId);

    expect(task!.labels).toEqual(["feature"]);
    expect(task!.input).toEqual({ prompt: "new prompt" });
  });

  it("getBoard returns tasks with parsed labels and input", async () => {
    const { getBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await getBoard(db, boardId);

    expect(board).toBeTruthy();
    const task = board!.tasks.find((t) => t.id === taskId)!;
    expect(Array.isArray(task.labels)).toBe(true);
    expect(task.labels).toEqual(["feature"]);
    expect(typeof task.input).toBe("object");
    expect(task.input).toEqual({ prompt: "new prompt" });
  });

  it("lifecycle functions preserve parsed JSON fields", async () => {
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const { assignTask, claimTask, reviewTask } = await import(
      "../apps/web/functions/api/taskRepo"
    );

    const agent = await createAgent(db, ownerId, { name: "worker" });
    const assigned = await assignTask(db, taskId, agent.id);
    expect(Array.isArray(assigned!.labels)).toBe(true);

    const claimed = await claimTask(db, taskId, agent.id, "agent");
    expect(Array.isArray(claimed!.labels)).toBe(true);
    expect(typeof claimed!.input).toBe("object");

    const reviewed = await reviewTask(db, taskId, agent.id, "https://github.com/pr/1", "agent");
    expect(Array.isArray(reviewed!.labels)).toBe(true);
    expect(typeof reviewed!.input).toBe("object");
  });
});
