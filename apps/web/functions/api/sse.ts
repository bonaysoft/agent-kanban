import { listMessages } from "./messageRepo";
import { getTaskNotes } from "./taskRepo";
import type { Env } from "./types";

interface SSEEvent {
  id: string;
  type: "note" | "message";
  data: string;
  created_at: string;
}

function mergeByTime(notes: SSEEvent[], messages: SSEEvent[]): SSEEvent[] {
  const merged: SSEEvent[] = [];
  let i = 0,
    j = 0;
  while (i < notes.length && j < messages.length) {
    if (notes[i].created_at <= messages[j].created_at) merged.push(notes[i++]);
    else merged.push(messages[j++]);
  }
  while (i < notes.length) merged.push(notes[i++]);
  while (j < messages.length) merged.push(messages[j++]);
  return merged;
}

export async function createSSEResponse(env: Env, taskId: string, lastEventId: string | null): Promise<Response> {
  const db = env.DB;

  // Resolve lastEventId before creating the stream
  let since: string | undefined;
  if (lastEventId) {
    const ref = await db
      .prepare("SELECT created_at FROM task_notes WHERE id = ? UNION SELECT created_at FROM messages WHERE id = ?")
      .bind(lastEventId, lastEventId)
      .first<{ created_at: string }>();
    if (!ref) {
      return Response.json(
        {
          error: {
            code: "INVALID_LAST_EVENT_ID",
            message: "Unknown event ID, reconnect without Last-Event-ID",
          },
        },
        { status: 400 },
      );
    }
    since = ref.created_at;
  }

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
    const [initialNotes, initialMessages] = await Promise.all([getTaskNotes(db, taskId, since), listMessages(db, taskId, since)]);

    const noteEvents: SSEEvent[] = (since ? initialNotes : initialNotes.slice(-50)).map((l) => ({
      id: l.id,
      type: "note" as const,
      data: JSON.stringify(l),
      created_at: l.created_at,
    }));
    const msgEvents: SSEEvent[] = (since ? initialMessages : initialMessages.slice(-50)).map((m) => ({
      id: m.id,
      type: "message" as const,
      data: JSON.stringify(m),
      created_at: m.created_at,
    }));

    const batch = mergeByTime(noteEvents, msgEvents);
    for (const event of batch) {
      await write(event);
    }

    let lastSeen = batch.length > 0 ? batch[batch.length - 1].created_at : since || new Date().toISOString();

    // Poll every 2s for up to 25s (CF Workers 30s limit)
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));

      const [newNotes, newMessages] = await Promise.all([getTaskNotes(db, taskId, lastSeen), listMessages(db, taskId, lastSeen)]);

      const newNoteEvents = newNotes.map((l) => ({
        id: l.id,
        type: "note" as const,
        data: JSON.stringify(l),
        created_at: l.created_at,
      }));
      const newMsgEvents = newMessages.map((m) => ({
        id: m.id,
        type: "message" as const,
        data: JSON.stringify(m),
        created_at: m.created_at,
      }));
      const merged = mergeByTime(newNoteEvents, newMsgEvents);

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
