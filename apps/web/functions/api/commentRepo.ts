import type { Comment, AuthorType } from "@agent-kanban/shared";
import { newLongId, type D1 } from "./db";

export async function createComment(
  db: D1,
  taskId: string,
  authorType: AuthorType,
  authorId: string,
  content: string,
  mentions: string[] | null,
): Promise<Comment> {
  const id = newLongId();
  const now = new Date().toISOString();
  const mentionsJson = mentions?.length ? JSON.stringify(mentions) : null;

  await db.prepare(
    "INSERT INTO task_comments (id, task_id, author_type, author_id, content, mentions, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(id, taskId, authorType, authorId, content, mentionsJson, now).run();

  return { id, task_id: taskId, author_type: authorType, author_id: authorId, content, mentions: mentionsJson, created_at: now };
}

export async function listComments(
  db: D1,
  taskId: string,
  since?: string,
): Promise<Comment[]> {
  const query = since
    ? db.prepare("SELECT * FROM task_comments WHERE task_id = ? AND created_at > ? ORDER BY created_at ASC").bind(taskId, since)
    : db.prepare("SELECT * FROM task_comments WHERE task_id = ? ORDER BY created_at ASC").bind(taskId);
  const result = await query.all<Comment>();
  return result.results;
}
