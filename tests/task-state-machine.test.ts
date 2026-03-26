// @vitest-environment node

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { SignJWT } from "jose";
import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const MIGRATIONS_DIR = join(__dirname, "../apps/web/migrations");
const AUTH_SECRET = "test-secret-32-chars-minimum-ok!!";
const BETTER_AUTH_URL = "http://localhost:8788";

const env = {
  DB: null as any as D1Database,
  AUTH_SECRET,
  ALLOWED_HOSTS: "localhost:8788",
  GITHUB_CLIENT_ID: "x",
  GITHUB_CLIENT_SECRET: "x",
};

let mf: Miniflare;

async function applyMigrations(db: D1Database) {
  const files = ["0001_initial.sql", "0002_rename_task_logs_to_task_notes.sql", "0003_agent_kind.sql"];
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

async function seedUser(db: D1Database): Promise<string> {
  const userId = "test-user-sm";
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO user (id, name, email, emailVerified, createdAt, updatedAt) VALUES (?, ?, ?, 1, ?, ?)")
    .bind(userId, "SM Test User", "sm@example.com", now, now)
    .run();
  return userId;
}

async function createApiKeyForUser(db: D1Database, userId: string): Promise<string> {
  const { createAuth } = await import("../apps/web/functions/api/betterAuth");
  const auth = createAuth({ ...env, DB: db });
  const result = await auth.api.createApiKey({ body: { userId } });
  return result.key;
}

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } }",
    d1Databases: { DB: "test-db" },
  });
  env.DB = await mf.getD1Database("DB");
  await applyMigrations(env.DB);
});

afterAll(async () => {
  await mf.dispose();
});

// ─── Unit tests: validateTransition ───

describe("validateTransition", () => {
  let validateTransition: typeof import("@agent-kanban/shared").validateTransition;

  beforeAll(async () => {
    ({ validateTransition } = await import("@agent-kanban/shared"));
  });

  // Valid transitions
  it("allows claim: todo → in_progress (agent:worker)", () => {
    expect(validateTransition("claim", "todo", "agent:worker")).toBeNull();
  });

  it("allows review: in_progress → in_review (agent:worker)", () => {
    expect(validateTransition("review", "in_progress", "agent:worker")).toBeNull();
  });

  it("allows reject: in_review → in_progress (agent:leader)", () => {
    expect(validateTransition("reject", "in_review", "agent:leader")).toBeNull();
  });

  it("allows complete: in_review → done (agent:leader)", () => {
    expect(validateTransition("complete", "in_review", "agent:leader")).toBeNull();
  });

  it("allows cancel: in_progress → cancelled (agent:leader)", () => {
    expect(validateTransition("cancel", "in_progress", "agent:leader")).toBeNull();
  });

  it("allows cancel: in_review → cancelled (agent:leader)", () => {
    expect(validateTransition("cancel", "in_review", "agent:leader")).toBeNull();
  });

  it("allows release: in_progress → todo (machine)", () => {
    expect(validateTransition("release", "in_progress", "machine")).toBeNull();
  });

  it("allows release: in_review → todo (machine)", () => {
    expect(validateTransition("release", "in_review", "machine")).toBeNull();
  });

  // Invalid transitions — wrong source status
  it("rejects claim from in_progress", () => {
    const err = validateTransition("claim", "in_progress", "agent:worker");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects claim from done", () => {
    const err = validateTransition("claim", "done", "agent:worker");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects review from todo", () => {
    const err = validateTransition("review", "todo", "agent:worker");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects review from in_review", () => {
    const err = validateTransition("review", "in_review", "agent:worker");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects complete from todo", () => {
    const err = validateTransition("complete", "todo", "agent:leader");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects complete from in_progress", () => {
    const err = validateTransition("complete", "in_progress", "agent:leader");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects cancel from todo", () => {
    const err = validateTransition("cancel", "todo", "agent:leader");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects cancel from done", () => {
    const err = validateTransition("cancel", "done", "agent:leader");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects cancel from cancelled", () => {
    const err = validateTransition("cancel", "cancelled", "agent:leader");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects reject from in_progress", () => {
    const err = validateTransition("reject", "in_progress", "agent:leader");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects release from todo", () => {
    const err = validateTransition("release", "todo", "machine");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  it("rejects release from done", () => {
    const err = validateTransition("release", "done", "machine");
    expect(err?.code).toBe("INVALID_TRANSITION");
  });

  // Terminal states — nothing allowed
  it("rejects all actions from done", () => {
    for (const action of ["claim", "review", "reject", "complete", "cancel", "release"] as const) {
      const identities = ["machine", "agent:worker", "agent:leader"] as const;
      for (const id of identities) {
        const err = validateTransition(action, "done", id);
        expect(err).not.toBeNull();
      }
    }
  });

  it("rejects all actions from cancelled", () => {
    for (const action of ["claim", "review", "reject", "complete", "cancel", "release"] as const) {
      const identities = ["machine", "agent:worker", "agent:leader"] as const;
      for (const id of identities) {
        const err = validateTransition(action, "cancelled", id);
        expect(err).not.toBeNull();
      }
    }
  });

  // Permission violations — wrong identity
  it("rejects claim by machine", () => {
    const err = validateTransition("claim", "todo", "machine");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("rejects claim by agent:leader", () => {
    const err = validateTransition("claim", "todo", "agent:leader");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("rejects review by machine", () => {
    const err = validateTransition("review", "in_progress", "machine");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("rejects review by agent:leader", () => {
    const err = validateTransition("review", "in_progress", "agent:leader");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("allows complete by machine", () => {
    expect(validateTransition("complete", "in_review", "machine")).toBeNull();
  });

  it("rejects complete by agent:worker", () => {
    const err = validateTransition("complete", "in_review", "agent:worker");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("allows cancel by machine", () => {
    expect(validateTransition("cancel", "in_progress", "machine")).toBeNull();
  });

  it("rejects cancel by agent:worker", () => {
    const err = validateTransition("cancel", "in_progress", "agent:worker");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("rejects reject by machine", () => {
    const err = validateTransition("reject", "in_review", "machine");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("rejects reject by agent:worker", () => {
    const err = validateTransition("reject", "in_review", "agent:worker");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("rejects release by agent:worker", () => {
    const err = validateTransition("release", "in_progress", "agent:worker");
    expect(err?.code).toBe("FORBIDDEN");
  });

  it("rejects release by agent:leader", () => {
    const err = validateTransition("release", "in_progress", "agent:leader");
    expect(err?.code).toBe("FORBIDDEN");
  });
});

// ─── Integration tests: repo functions ───

describe("task lifecycle repo functions", () => {
  const userId = "test-user-sm";
  let boardId: string;
  let testAgentId: string;
  let otherAgentId: string;

  async function createTestTask() {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    return createTask(env.DB, userId, { title: `Task ${randomUUID().slice(0, 8)}`, board_id: boardId });
  }

  async function forceStatus(taskId: string, status: string) {
    await env.DB.prepare("UPDATE tasks SET status = ? WHERE id = ?").bind(status, taskId).run();
  }

  beforeAll(async () => {
    await seedUser(env.DB);
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, userId, "sm-board");
    boardId = board.id;
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await createAgent(env.DB, userId, { name: "SM Test Agent" });
    testAgentId = agent.id;
    const agent2 = await createAgent(env.DB, userId, { name: "SM Agent 2" });
    otherAgentId = agent2.id;
  });

  describe("claim", () => {
    it("succeeds: todo → in_progress (agent:worker)", async () => {
      const { claimTask, assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await assignTask(env.DB, task.id, testAgentId);
      const result = await claimTask(env.DB, task.id, testAgentId, "agent:worker");
      expect(result!.status).toBe("in_progress");
    });

    it("rejects claim from in_progress", async () => {
      const { claimTask, assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await assignTask(env.DB, task.id, testAgentId);
      await forceStatus(task.id, "in_progress");
      await expect(claimTask(env.DB, task.id, testAgentId, "agent:worker")).rejects.toThrow();
    });

    it("rejects claim by wrong agent", async () => {
      const { claimTask, assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await assignTask(env.DB, task.id, testAgentId);
      await expect(claimTask(env.DB, task.id, otherAgentId, "agent:worker")).rejects.toThrow("not assigned");
    });
  });

  describe("review", () => {
    it("succeeds: in_progress → in_review (agent:worker)", async () => {
      const { reviewTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      const result = await reviewTask(env.DB, task.id, testAgentId, null, "agent:worker");
      expect(result!.status).toBe("in_review");
    });

    it("rejects review from todo", async () => {
      const { reviewTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await expect(reviewTask(env.DB, task.id, testAgentId, null, "agent:worker")).rejects.toThrow();
    });

    it("rejects review by machine", async () => {
      const { reviewTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(reviewTask(env.DB, task.id, null, null, "machine")).rejects.toThrow();
    });
  });

  describe("reject", () => {
    it("succeeds: in_review → in_progress (agent:leader)", async () => {
      const { rejectTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_review");
      const result = await rejectTask(env.DB, task.id, null, "agent:leader");
      expect(result!.status).toBe("in_progress");
    });

    it("rejects reject from in_progress", async () => {
      const { rejectTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(rejectTask(env.DB, task.id, null, "agent:leader")).rejects.toThrow();
    });

    it("rejects reject by agent:worker", async () => {
      const { rejectTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_review");
      await expect(rejectTask(env.DB, task.id, null, "agent:worker")).rejects.toThrow();
    });
  });

  describe("complete", () => {
    it("succeeds: in_review → done (agent:leader)", async () => {
      const { completeTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_review");
      const result = await completeTask(env.DB, task.id, null, "done", null, "agent:leader");
      expect(result!.status).toBe("done");
    });

    it("rejects complete from todo", async () => {
      const { completeTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await expect(completeTask(env.DB, task.id, null, null, null, "agent:leader")).rejects.toThrow();
    });

    it("rejects complete from in_progress", async () => {
      const { completeTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(completeTask(env.DB, task.id, null, null, null, "agent:leader")).rejects.toThrow();
    });

    it("rejects complete by agent:worker", async () => {
      const { completeTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_review");
      await expect(completeTask(env.DB, task.id, null, null, null, "agent:worker")).rejects.toThrow();
    });
  });

  describe("cancel", () => {
    it("succeeds: in_progress → cancelled (agent:leader)", async () => {
      const { cancelTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      const result = await cancelTask(env.DB, task.id, null, "agent:leader");
      expect(result!.status).toBe("cancelled");
    });

    it("succeeds: in_review → cancelled (agent:leader)", async () => {
      const { cancelTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_review");
      const result = await cancelTask(env.DB, task.id, null, "agent:leader");
      expect(result!.status).toBe("cancelled");
    });

    it("rejects cancel from todo", async () => {
      const { cancelTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await expect(cancelTask(env.DB, task.id, null, "agent:leader")).rejects.toThrow();
    });

    it("rejects cancel from done", async () => {
      const { cancelTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "done");
      await expect(cancelTask(env.DB, task.id, null, "agent:leader")).rejects.toThrow();
    });

    it("rejects cancel from cancelled", async () => {
      const { cancelTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "cancelled");
      await expect(cancelTask(env.DB, task.id, null, "agent:leader")).rejects.toThrow();
    });

    it("rejects cancel by agent:worker", async () => {
      const { cancelTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(cancelTask(env.DB, task.id, null, "agent:worker")).rejects.toThrow();
    });
  });

  describe("release", () => {
    it("succeeds: in_progress → todo (machine)", async () => {
      const { releaseTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      const result = await releaseTask(env.DB, task.id, null, "machine");
      expect(result!.status).toBe("todo");
    });

    it("succeeds: in_review → todo (machine)", async () => {
      const { releaseTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_review");
      const result = await releaseTask(env.DB, task.id, null, "machine");
      expect(result!.status).toBe("todo");
    });

    it("rejects release from todo", async () => {
      const { releaseTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await expect(releaseTask(env.DB, task.id, null, "machine")).rejects.toThrow();
    });

    it("rejects release by agent:worker", async () => {
      const { releaseTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(releaseTask(env.DB, task.id, null, "agent:worker")).rejects.toThrow();
    });

    it("rejects release by agent:leader", async () => {
      const { releaseTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(releaseTask(env.DB, task.id, null, "agent:leader")).rejects.toThrow();
    });
  });

  describe("assign restrictions", () => {
    it("succeeds: assign in todo with no existing assignment", async () => {
      const { assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      const result = await assignTask(env.DB, task.id, testAgentId);
      expect(result!.assigned_to).toBe(testAgentId);
    });

    it("rejects assign when already assigned", async () => {
      const { assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await assignTask(env.DB, task.id, testAgentId);
      await expect(assignTask(env.DB, task.id, otherAgentId)).rejects.toThrow("already assigned");
    });

    it("rejects assign in in_progress", async () => {
      const { assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(assignTask(env.DB, task.id, testAgentId)).rejects.toThrow("todo");
    });

    it("rejects assign in done", async () => {
      const { assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "done");
      await expect(assignTask(env.DB, task.id, testAgentId)).rejects.toThrow("todo");
    });
  });

  describe("delete restrictions", () => {
    it("succeeds: delete unassigned todo", async () => {
      const { deleteTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      const result = await deleteTask(env.DB, task.id);
      expect(result).toBe(true);
    });

    it("succeeds: delete cancelled task", async () => {
      const { deleteTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "cancelled");
      const result = await deleteTask(env.DB, task.id);
      expect(result).toBe(true);
    });

    it("allows delete of assigned todo", async () => {
      const { deleteTask, assignTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await assignTask(env.DB, task.id, testAgentId);
      const result = await deleteTask(env.DB, task.id);
      expect(result).toBe(true);
    });

    it("rejects delete of in_progress task", async () => {
      const { deleteTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_progress");
      await expect(deleteTask(env.DB, task.id)).rejects.toThrow("Cannot delete");
    });

    it("rejects delete of in_review task", async () => {
      const { deleteTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "in_review");
      await expect(deleteTask(env.DB, task.id)).rejects.toThrow("Cannot delete");
    });

    it("rejects delete of done task", async () => {
      const { deleteTask } = await import("../apps/web/functions/api/taskRepo");
      const task = await createTestTask();
      await forceStatus(task.id, "done");
      await expect(deleteTask(env.DB, task.id)).rejects.toThrow("Cannot delete");
    });
  });
});

// ─── HTTP-level permission tests ───

describe("task lifecycle HTTP permissions", () => {
  let userId: string;
  let apiKey: string;
  let _machineId: string;
  let agentId: string;
  let sessionId: string;
  let sessionPrivateKey: CryptoKey;
  let boardId: string;

  async function apiRequest(method: string, path: string, body?: any, token?: string) {
    const { api } = await import("../apps/web/functions/api/routes");
    const headers: Record<string, string> = { "Content-Type": "application/json", Host: "localhost:8788", "x-forwarded-proto": "http" };
    if (token) headers.Authorization = `Bearer ${token}`;
    const init: RequestInit = { method, headers };
    if (body) init.body = JSON.stringify(body);
    return api.request(path, init, env);
  }

  async function signSessionJWT(): Promise<string> {
    return new SignJWT({ sub: sessionId, aid: agentId, jti: randomUUID(), aud: BETTER_AUTH_URL })
      .setProtectedHeader({ alg: "EdDSA", typ: "agent+jwt" })
      .setIssuedAt()
      .setExpirationTime("60s")
      .sign(sessionPrivateKey);
  }

  async function createTestTask() {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    return createTask(env.DB, userId, { title: `HTTP Task ${randomUUID().slice(0, 8)}`, board_id: boardId });
  }

  async function forceStatus(taskId: string, status: string) {
    await env.DB.prepare("UPDATE tasks SET status = ? WHERE id = ?").bind(status, taskId).run();
  }

  beforeAll(async () => {
    // Reuse user from previous describe block or create new
    userId = "test-user-sm";
    apiKey = await createApiKeyForUser(env.DB, userId);

    // Create machine
    const res = await apiRequest(
      "POST",
      "/api/machines",
      {
        name: "sm-machine",
        os: "darwin",
        version: "1.0.0",
        runtimes: ["Claude Code"],
      },
      apiKey,
    );
    _machineId = ((await res.json()) as any).id;

    // Create agent
    const { createAgent } = await import("../apps/web/functions/api/agentRepo");
    const agent = await createAgent(env.DB, userId, { name: "SM Agent", runtime: "Claude Code" });
    agentId = agent.id;

    // Create session
    sessionId = randomUUID();
    const keypair = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    sessionPrivateKey = (keypair as any).privateKey;
    const pubJwk = await crypto.subtle.exportKey("jwk", (keypair as any).publicKey);
    await apiRequest(
      "POST",
      `/api/agents/${agentId}/sessions`,
      {
        session_id: sessionId,
        session_public_key: pubJwk.x!,
      },
      apiKey,
    );

    // Create board
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, userId, "sm-http-board");
    boardId = board.id;
  });

  it("agent cannot complete a task (403)", async () => {
    const task = await createTestTask();
    await forceStatus(task.id, "in_review");
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/complete`, {}, jwt);
    expect(res.status).toBe(403);
  });

  it("agent cannot cancel a task (403)", async () => {
    const task = await createTestTask();
    await forceStatus(task.id, "in_progress");
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/cancel`, {}, jwt);
    expect(res.status).toBe(403);
  });

  it("agent cannot reject a task (403)", async () => {
    const task = await createTestTask();
    await forceStatus(task.id, "in_review");
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/reject`, {}, jwt);
    expect(res.status).toBe(403);
  });

  it("agent cannot release a task (403)", async () => {
    const task = await createTestTask();
    await forceStatus(task.id, "in_progress");
    const jwt = await signSessionJWT();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/release`, {}, jwt);
    expect(res.status).toBe(403);
  });

  it("machine can release a task (200)", async () => {
    const task = await createTestTask();
    const { assignTask } = await import("../apps/web/functions/api/taskRepo");
    await assignTask(env.DB, task.id, agentId);
    await forceStatus(task.id, "in_progress");
    const res = await apiRequest("POST", `/api/tasks/${task.id}/release`, {}, apiKey);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.status).toBe("todo");
  });

  it("machine cannot claim a task (403)", async () => {
    const task = await createTestTask();
    const res = await apiRequest("POST", `/api/tasks/${task.id}/claim`, { agent_id: agentId }, apiKey);
    expect(res.status).toBe(403);
  });

  it("machine cannot review a task (403)", async () => {
    const task = await createTestTask();
    await forceStatus(task.id, "in_progress");
    const res = await apiRequest("POST", `/api/tasks/${task.id}/review`, {}, apiKey);
    expect(res.status).toBe(403);
  });
});
