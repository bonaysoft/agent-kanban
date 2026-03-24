import type { Message, SenderType } from '@agent-kanban/shared';
import { newLongId, type D1 } from './db';

export async function createMessage(
  db: D1,
  taskId: string,
  senderType: SenderType,
  senderId: string,
  content: string,
): Promise<Message> {
  const id = newLongId();
  const now = new Date().toISOString();
  await db
    .prepare(
      'INSERT INTO messages (id, task_id, sender_type, sender_id, content, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    )
    .bind(id, taskId, senderType, senderId, content, now)
    .run();

  return {
    id,
    task_id: taskId,
    sender_type: senderType,
    sender_id: senderId,
    content,
    created_at: now,
  };
}

export async function listMessages(db: D1, taskId: string, since?: string): Promise<Message[]> {
  const query = since
    ? db
        .prepare(
          'SELECT * FROM messages WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC',
        )
        .bind(taskId, since)
    : db.prepare('SELECT * FROM messages WHERE task_id = ? ORDER BY created_at ASC').bind(taskId);
  const result = await query.all<Message>();
  return result.results;
}
