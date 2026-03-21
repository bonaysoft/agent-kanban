import type { D1 } from "./db";
import { validateToken } from "./auth";
import { createAuth } from "./betterAuth";
import type { Env } from "./types";
import { getTaskLogs } from "./taskRepo";
import { listMessages } from "./messageRepo";

interface SSEEvent {
  id: string;
  type: "log" | "message";
  data: string;
  created_at: string;
}

function mergeByTime(logs: SSEEvent[], messages: SSEEvent[]): SSEEvent[] {
  const merged: SSEEvent[] = [];
  let i = 0, j = 0;
  while (i < logs.length && j < messages.length) {
    if (logs[i].created_at <= messages[j].created_at) merged.push(logs[i++]);
    else merged.push(messages[j++]);
  }
  while (i < logs.length) merged.push(logs[i++]);
  while (j < messages.length) merged.push(messages[j++]);
  return merged;
}

export async function createSSEResponse(
  env: Env,
  taskId: string,
  lastEventId: string | null,
  token: string,
): Promise<Response> {
  // Try machine API key first (ak_ prefix), then better-auth session token
  let authenticated = false;
  if (token.startsWith("ak_")) {
    authenticated = !!(await validateToken(env.DB, token));
  } else {
    const auth = createAuth(env);
    const session = await auth.api.getSession({
      headers: new Headers({ Authorization: `Bearer ${token}` }),
    });
    authenticated = !!session;
  }

  if (!authenticated) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const db = env.DB;

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (event: SSEEvent) => {
    let msg = `id: ${event.id}\n`;
    msg += `event: ${event.type}\n`;
    msg += `data: ${event.data}\n\n`;
    return writer.write(encoder.encode(msg));
  };

  const run = async () => {
    // Resolve lastEventId to a timestamp for since-based filtering
    let since: string | undefined;
    if (lastEventId) {
      const ref = await db.prepare(
        "SELECT created_at FROM task_logs WHERE id = ? UNION SELECT created_at FROM messages WHERE id = ?",
      ).bind(lastEventId, lastEventId).first<{ created_at: string }>();
      since = ref?.created_at;
    }

    const [initialLogs, initialMessages] = await Promise.all([
      getTaskLogs(db, taskId, since),
      listMessages(db, taskId, since),
    ]);

    const logEvents: SSEEvent[] = (since ? initialLogs : initialLogs.slice(-50))
      .map((l) => ({ id: l.id, type: "log" as const, data: JSON.stringify(l), created_at: l.created_at }));
    const msgEvents: SSEEvent[] = (since ? initialMessages : initialMessages.slice(-50))
      .map((m) => ({ id: m.id, type: "message" as const, data: JSON.stringify(m), created_at: m.created_at }));

    const batch = mergeByTime(logEvents, msgEvents);
    for (const event of batch) {
      await write(event);
    }

    let lastSeen = batch.length > 0
      ? batch[batch.length - 1].created_at
      : (since || new Date().toISOString());

    // Poll every 2s for up to 25s (CF Workers 30s limit)
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      const [newLogs, newMessages] = await Promise.all([
        getTaskLogs(db, taskId, lastSeen),
        listMessages(db, taskId, lastSeen),
      ]);

      const newLogEvents = newLogs.map((l) => ({ id: l.id, type: "log" as const, data: JSON.stringify(l), created_at: l.created_at }));
      const newMsgEvents = newMessages.map((m) => ({ id: m.id, type: "message" as const, data: JSON.stringify(m), created_at: m.created_at }));
      const merged = mergeByTime(newLogEvents, newMsgEvents);

      for (const event of merged) {
        await write(event);
      }

      if (merged.length > 0) {
        lastSeen = merged[merged.length - 1].created_at;
      }
    }

    await writer.close();
  };

  // Run in background — don't await
  run().catch(() => writer.close().catch(() => {}));

  return new Response(readable, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
