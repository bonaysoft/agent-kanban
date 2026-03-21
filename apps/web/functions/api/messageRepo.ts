import type { Message } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export async function createMessage(
  db: D1,
  taskId: string,
  agentId: string,
  role: "human" | "agent",
  content: string,
): Promise<Message> {
  const id = newId();
  await db
    .prepare(
      "INSERT INTO messages (id, task_id, agent_id, role, content) VALUES (?, ?, ?, ?, ?)",
    )
    .bind(id, taskId, agentId, role, content)
    .run();

  return { id, task_id: taskId, agent_id: agentId, role, content, created_at: new Date().toISOString() };
}

export async function listMessages(
  db: D1,
  taskId: string,
  since?: string,
): Promise<Message[]> {
  const query = since
    ? db.prepare("SELECT * FROM messages WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC").bind(taskId, since)
    : db.prepare("SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC").bind(taskId);
  const result = await query.all<Message>();
  return result.results;
}
