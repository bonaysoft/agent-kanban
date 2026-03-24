// @vitest-environment node

import type { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

const env = createTestEnv();
let mf: Miniflare;

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
  await seedUser(env.DB, "sse-user", "sse@test.com");
});

afterAll(async () => {
  await mf.dispose();
});

async function readSSEUntil(
  body: ReadableStream,
  matchFn: (text: string) => boolean,
  timeoutMs = 3000,
  readTimeoutMs = 200,
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await Promise.race([
      reader.read(),
      new Promise<{ done: true; value: undefined }>((resolve) =>
        setTimeout(() => resolve({ done: true, value: undefined }), readTimeoutMs),
      ),
    ]);
    if (result.value) {
      text += decoder.decode(result.value, { stream: true });
    }
    if (result.done || matchFn(text)) break;
  }
  reader.cancel();
  return text;
}

describe("createSSEResponse", () => {
  let boardId: string;
  let taskId: string;

  beforeAll(async () => {
    const { createBoard } = await import("../apps/web/functions/api/boardRepo");
    const board = await createBoard(env.DB, "sse-user", "SSE Board");
    boardId = board.id;

    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const task = await createTask(env.DB, "sse-user", { title: "SSE Task", board_id: boardId });
    taskId = task.id;
  });

  it("returns a Response with correct SSE headers", async () => {
    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, taskId, null);
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Connection")).toBe("keep-alive");
  });

  it("streams initial logs as SSE events", async () => {
    const { addTaskLog } = await import("../apps/web/functions/api/taskRepo");
    await addTaskLog(env.DB, taskId, null, "commented", "Log entry 1");
    await addTaskLog(env.DB, taskId, null, "commented", "Log entry 2");

    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, taskId, null);
    const text = await readSSEUntil(response.body!, (t) => t.includes("Log entry 2"));

    expect(text).toContain("event: log");
    expect(text).toContain("Log entry 1");
    expect(text).toContain("Log entry 2");
    expect(text).toContain("id: ");
    expect(text).toContain("data: ");
  });

  it("streams messages as SSE events", async () => {
    const { createMessage } = await import("../apps/web/functions/api/messageRepo");
    await createMessage(env.DB, taskId, "user", "sse-user", "Hello from user");

    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, taskId, null);
    const text = await readSSEUntil(response.body!, (t) => t.includes("event: message"));

    expect(text).toContain("event: message");
    expect(text).toContain("Hello from user");
  });

  it("resumes from lastEventId", async () => {
    const { addTaskLog, getTaskLogs } = await import("../apps/web/functions/api/taskRepo");
    await addTaskLog(env.DB, taskId, null, "commented", "Before resume");
    const logsBeforeResume = await getTaskLogs(env.DB, taskId);
    const lastLogId = logsBeforeResume[logsBeforeResume.length - 1].id;

    // Small delay to ensure distinct timestamp in D1 (millisecond resolution)
    await new Promise((r) => setTimeout(r, 50));
    await addTaskLog(env.DB, taskId, null, "commented", "After resume");

    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, taskId, lastLogId);
    const text = await readSSEUntil(response.body!, (t) => t.includes("After resume"));

    expect(text).toContain("After resume");
  });

  it("returns stream for task with only creation log", async () => {
    const { createTask } = await import("../apps/web/functions/api/taskRepo");
    const freshTask = await createTask(env.DB, "sse-user", {
      title: "Fresh SSE Task",
      board_id: boardId,
    });

    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, freshTask.id, null);
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await readSSEUntil(response.body!, (t) => t.includes("event: log"));

    expect(text).toContain("event: log");
    expect(text).toContain('"action":"created"');
  });

  it("merges logs and messages by time order", async () => {
    const { createTask, addTaskLog } = await import("../apps/web/functions/api/taskRepo");
    const { createMessage } = await import("../apps/web/functions/api/messageRepo");
    const mergeTask = await createTask(env.DB, "sse-user", {
      title: "Merge SSE Task",
      board_id: boardId,
    });

    await createMessage(env.DB, mergeTask.id, "user", "sse-user", "Message first");
    // Small delay to ensure distinct timestamp in D1 (millisecond resolution)
    await new Promise((r) => setTimeout(r, 50));
    await addTaskLog(env.DB, mergeTask.id, null, "commented", "Log second");

    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, mergeTask.id, null);
    const text = await readSSEUntil(
      response.body!,
      (t) => t.includes("Message first") && t.includes("Log second"),
    );

    expect(text).toContain("event: message");
    expect(text).toContain("event: log");
    expect(text).toContain("Message first");
    expect(text).toContain("Log second");

    const msgPos = text.indexOf("Message first");
    const logPos = text.indexOf("Log second");
    expect(msgPos).toBeLessThan(logPos);
  });

  it("poll loop picks up new events after initial batch", async () => {
    const { createTask, addTaskLog } = await import("../apps/web/functions/api/taskRepo");
    const pollTask = await createTask(env.DB, "sse-user", {
      title: "Poll SSE Task",
      board_id: boardId,
    });

    setTimeout(async () => {
      await addTaskLog(env.DB, pollTask.id, null, "commented", "Polled event from loop");
    }, 500);

    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, pollTask.id, null);
    // Poll loop fires at 2s intervals — use a longer per-read timeout to avoid premature resolution
    const text = await readSSEUntil(
      response.body!,
      (t) => t.includes("Polled event from loop"),
      8000,
      3000,
    );

    expect(text).toContain("Polled event from loop");
  }, 15000);

  it("lastSeen defaults to current time when no batch and no since", async () => {
    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, "nonexistent-task-id", null);
    expect(response).toBeInstanceOf(Response);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");

    const text = await readSSEUntil(response.body!, () => false, 500);
    expect(text).toBe("");
  });

  it("limits initial events to 50 per type", async () => {
    const { createTask, addTaskLog } = await import("../apps/web/functions/api/taskRepo");
    const bigTask = await createTask(env.DB, "sse-user", {
      title: "Big SSE Task",
      board_id: boardId,
    });

    for (let i = 0; i < 55; i++) {
      await addTaskLog(env.DB, bigTask.id, null, "commented", `Bulk log ${i}`);
    }

    const { createSSEResponse } = await import("../apps/web/functions/api/sse");
    const response = await createSSEResponse(env as any, bigTask.id, null);
    const text = await readSSEUntil(
      response.body!,
      (t) => (t.match(/event: log/g) || []).length >= 50,
    );

    const logEventCount = (text.match(/event: log/g) || []).length;
    expect(logEventCount).toBeLessThanOrEqual(50);
    expect(text).not.toContain("Bulk log 0");
    expect(text).toContain("Bulk log 54");
  });
});
