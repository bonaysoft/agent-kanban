// @vitest-environment node

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getSystemStats } from "../apps/web/functions/api/statsRepo";
import { createTestAgent, createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

const env = createTestEnv();
let mf: Miniflare;

async function apiRequest(method: string, path: string, body?: Record<string, unknown>, token?: string) {
  const { api } = await import("../apps/web/functions/api/routes");
  const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const init: RequestInit = { method, headers };
  if (body && method !== "GET") init.body = JSON.stringify(body);
  return api.request(path, init, env);
}

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
});

afterAll(async () => {
  await mf.dispose();
});

// ─── getSystemStats unit tests ───

describe("getSystemStats", () => {
  it("returns the correct shape with all expected top-level fields", async () => {
    const stats = await getSystemStats(env.DB);
    expect(stats).toHaveProperty("users");
    expect(stats).toHaveProperty("agents");
    expect(stats).toHaveProperty("tasks");
    expect(stats).toHaveProperty("boards");
    expect(stats).toHaveProperty("machines");
  });

  it("returns users.total as a number", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.users.total).toBe("number");
  });

  it("returns users.recent as a number", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.users.recent).toBe("number");
  });

  it("returns agents.total as a number", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.agents.total).toBe("number");
  });

  it("returns agents.online as a number", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.agents.online).toBe("number");
  });

  it("returns tasks with all five status fields", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.tasks.todo).toBe("number");
    expect(typeof stats.tasks.in_progress).toBe("number");
    expect(typeof stats.tasks.in_review).toBe("number");
    expect(typeof stats.tasks.done).toBe("number");
    expect(typeof stats.tasks.cancelled).toBe("number");
  });

  it("returns boards.total as a number", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.boards.total).toBe("number");
  });

  it("returns machines.total as a number", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.machines.total).toBe("number");
  });

  it("returns machines.online as a number", async () => {
    const stats = await getSystemStats(env.DB);
    expect(typeof stats.machines.online).toBe("number");
  });

  it("returns zero task counts on an empty database", async () => {
    const stats = await getSystemStats(env.DB);
    expect(stats.tasks.todo).toBe(0);
    expect(stats.tasks.in_progress).toBe(0);
    expect(stats.tasks.in_review).toBe(0);
    expect(stats.tasks.done).toBe(0);
    expect(stats.tasks.cancelled).toBe(0);
  });

  it("returns zero board count on an empty database", async () => {
    const stats = await getSystemStats(env.DB);
    expect(stats.boards.total).toBe(0);
  });

  it("returns zero machine counts on an empty database", async () => {
    const stats = await getSystemStats(env.DB);
    expect(stats.machines.total).toBe(0);
    expect(stats.machines.online).toBe(0);
  });

  it("returns zero agent counts on an empty database", async () => {
    const stats = await getSystemStats(env.DB);
    expect(stats.agents.total).toBe(0);
    expect(stats.agents.online).toBe(0);
  });

  it("reflects seeded users in users.total", async () => {
    const before = await getSystemStats(env.DB);
    await seedUser(env.DB, "stats-seed-user-1", "stats-seed-1@test.com");
    const after = await getSystemStats(env.DB);
    expect(after.users.total).toBeGreaterThan(before.users.total);
  });

  it("reflects a recently created user in users.recent", async () => {
    const before = await getSystemStats(env.DB);
    await seedUser(env.DB, "stats-seed-user-2", "stats-seed-2@test.com");
    const after = await getSystemStats(env.DB);
    expect(after.users.recent).toBeGreaterThan(before.users.recent);
  });

  it("reflects seeded boards in boards.total", async () => {
    const before = await getSystemStats(env.DB);
    const userId = "stats-board-owner";
    await seedUser(env.DB, userId, "stats-board-owner@test.com");
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    await createBoard(env.DB, userId, "Stats Test Board", "dev");
    const after = await getSystemStats(env.DB);
    expect(after.boards.total).toBeGreaterThan(before.boards.total);
  });

  it("reflects task status counts after seeding tasks", async () => {
    const userId = "stats-task-owner";
    await seedUser(env.DB, userId, "stats-task-owner@test.com");
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, userId, "Stats Task Board", "ops");
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    await createTask(env.DB, userId, { title: "Stats Todo Task", board_id: board.id });

    const stats = await getSystemStats(env.DB);
    expect(stats.tasks.todo).toBeGreaterThanOrEqual(1);
  });

  it("reflects done task count after updating task to done", async () => {
    const userId = "stats-done-owner";
    await seedUser(env.DB, userId, "stats-done-owner@test.com");
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, userId, "Stats Done Board", "ops");
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, userId, { title: "Stats Done Task", board_id: board.id });
    await env.DB.prepare("UPDATE tasks SET status = 'done' WHERE id = ?").bind(task.id).run();

    const stats = await getSystemStats(env.DB);
    expect(stats.tasks.done).toBeGreaterThanOrEqual(1);
  });

  it("reflects seeded agents in agents.total", async () => {
    const before = await getSystemStats(env.DB);
    const userId = "stats-agent-owner";
    await seedUser(env.DB, userId, "stats-agent-owner@test.com");
    await createTestAgent(env.DB, userId, { name: "Stats Agent", username: "stats-agent", runtime: "claude" });
    const after = await getSystemStats(env.DB);
    expect(after.agents.total).toBeGreaterThan(before.agents.total);
  });
});

// ─── GET /api/admin/stats route tests ───

describe("GET /api/admin/stats", () => {
  let adminToken: string;
  let regularToken: string;
  let machineApiKey: string;

  beforeAll(async () => {
    const { createAuth } = await import("../apps/web/functions/api/betterAuth");
    const auth = createAuth(env);

    // Create admin user via signup then elevate role
    const adminResult = await auth.api.signUpEmail({
      body: { name: "Admin Stats User", email: "admin-stats@test.com", password: "admin-password-123" },
    });
    if (!adminResult.token) throw new Error("admin signUpEmail did not return a token");
    await env.DB.prepare("UPDATE user SET role = 'admin' WHERE email = ?").bind("admin-stats@test.com").run();
    adminToken = adminResult.token;

    // Create regular (non-admin) user via signup
    const regularResult = await auth.api.signUpEmail({
      body: { name: "Regular Stats User", email: "regular-stats@test.com", password: "regular-password-123" },
    });
    if (!regularResult.token) throw new Error("regular signUpEmail did not return a token");
    regularToken = regularResult.token;

    // Create a machine API key for testing machine identity blocking
    const machineKeyResult = await auth.api.createApiKey({ body: { userId: "machine-owner-for-stats" } });
    machineApiKey = machineKeyResult.key;
  });

  it("returns 401 when no token is provided", async () => {
    const res = await apiRequest("GET", "/api/admin/stats");
    expect(res.status).toBe(401);
  });

  it("returns 403 for a regular (non-admin) user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, regularToken);
    expect(res.status).toBe(403);
  });

  it("returns FORBIDDEN error code for a non-admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, regularToken);
    const body = (await res.json()) as any;
    expect(body.error).toBeDefined();
    expect(body.error.code).toBe("FORBIDDEN");
  });

  it("returns 403 for machine identity (API key auth)", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, machineApiKey);
    expect(res.status).toBe(403);
  });

  it("returns 200 for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    expect(res.status).toBe(200);
  });

  it("returns users field in stats for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("users");
  });

  it("returns agents field in stats for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("agents");
  });

  it("returns tasks field in stats for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("tasks");
  });

  it("returns boards field in stats for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("boards");
  });

  it("returns machines field in stats for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(body).toHaveProperty("machines");
  });

  it("returns numeric users.total for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.users.total).toBe("number");
  });

  it("returns numeric users.recent for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.users.recent).toBe("number");
  });

  it("returns numeric agents.total for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.agents.total).toBe("number");
  });

  it("returns numeric agents.online for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.agents.online).toBe("number");
  });

  it("returns numeric tasks.todo for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.tasks.todo).toBe("number");
  });

  it("returns numeric boards.total for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.boards.total).toBe("number");
  });

  it("returns numeric machines.total for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.machines.total).toBe("number");
  });

  it("returns numeric machines.online for an admin user", async () => {
    const res = await apiRequest("GET", "/api/admin/stats", undefined, adminToken);
    const body = (await res.json()) as any;
    expect(typeof body.machines.online).toBe("number");
  });
});
