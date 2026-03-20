import type { Board, BoardWithColumns, Column, ColumnWithTasks, Task } from "@agent-kanban/shared";
import { DEFAULT_COLUMNS } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export async function createBoard(db: D1, name: string): Promise<BoardWithColumns> {
  const boardId = newId();
  const now = new Date().toISOString();

  const columnIds = DEFAULT_COLUMNS.map(() => newId());

  const stmts = [
    db.prepare("INSERT INTO boards (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)")
      .bind(boardId, name, now, now),
    ...DEFAULT_COLUMNS.map((colName, i) =>
      db.prepare("INSERT INTO columns (id, board_id, name, position) VALUES (?, ?, ?, ?)")
        .bind(columnIds[i], boardId, colName, i)
    ),
  ];

  await db.batch(stmts);

  return {
    id: boardId,
    name,
    created_at: now,
    updated_at: now,
    columns: DEFAULT_COLUMNS.map((colName, i) => ({
      id: columnIds[i],
      board_id: boardId,
      name: colName,
      position: i,
      tasks: [],
    })),
  };
}

export async function listBoards(db: D1): Promise<Board[]> {
  const result = await db.prepare("SELECT * FROM boards ORDER BY created_at DESC").all<Board>();
  return result.results;
}

export async function getBoard(db: D1, boardId: string): Promise<BoardWithColumns | null> {
  const board = await db.prepare("SELECT * FROM boards WHERE id = ?").bind(boardId).first<Board>();
  if (!board) return null;

  const columns = await db.prepare(
    "SELECT * FROM columns WHERE board_id = ? ORDER BY position"
  ).bind(boardId).all<Column>();

  const tasks = await db.prepare(`
    SELECT t.* FROM tasks t
    JOIN columns c ON t.column_id = c.id
    WHERE c.board_id = ?
    ORDER BY t.position
  `).bind(boardId).all<Task>();

  const columnMap = new Map<string, Task[]>();
  for (const task of tasks.results) {
    const list = columnMap.get(task.column_id) || [];
    list.push(task);
    columnMap.set(task.column_id, list);
  }

  return {
    ...board,
    columns: columns.results.map((col) => ({
      ...col,
      tasks: columnMap.get(col.id) || [],
    })),
  };
}

export async function deleteBoard(db: D1, boardId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM boards WHERE id = ?").bind(boardId).run();
  return result.meta.changes > 0;
}

export async function getDefaultBoard(db: D1): Promise<Board | null> {
  return db.prepare("SELECT * FROM boards ORDER BY created_at ASC LIMIT 1").first<Board>();
}

export async function getColumnByBoardAndName(db: D1, boardId: string, columnName: string): Promise<Column | null> {
  return db.prepare(
    "SELECT * FROM columns WHERE board_id = ? AND name = ? COLLATE NOCASE"
  ).bind(boardId, columnName).first<Column>();
}
