import type { D1 } from "./db";
import { validateToken } from "./auth";
import { getTaskLogs } from "./taskRepo";

export async function createSSEResponse(
  db: D1,
  taskId: string,
  lastEventId: string | null,
  token: string,
): Promise<Response> {
  const apiKey = await validateToken(db, token);
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "Invalid token" } }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();

  const write = (data: string, id?: string) => {
    let msg = "";
    if (id) msg += `id: ${id}\n`;
    msg += `data: ${data}\n\n`;
    return writer.write(encoder.encode(msg));
  };

  const run = async () => {
    // Resolve lastEventId (a log ID) to a timestamp for since-based filtering
    let since: string | undefined;
    if (lastEventId) {
      const ref = await db.prepare("SELECT created_at FROM task_logs WHERE id = ?").bind(lastEventId).first<{ created_at: string }>();
      since = ref?.created_at;
    }
    const initialLogs = await getTaskLogs(db, taskId, since);
    const batch = since ? initialLogs : initialLogs.slice(-50);

    for (const log of batch) {
      await write(JSON.stringify(log), log.id);
    }

    let lastSeen = batch.length > 0 ? batch[batch.length - 1].created_at : (since || new Date().toISOString());

    // Poll every 2s for up to 25s (CF Workers 30s limit)
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      const newLogs = await getTaskLogs(db, taskId, lastSeen);
      for (const log of newLogs) {
        await write(JSON.stringify(log), log.id);
      }

      if (newLogs.length > 0) {
        lastSeen = newLogs[newLogs.length - 1].created_at;
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
