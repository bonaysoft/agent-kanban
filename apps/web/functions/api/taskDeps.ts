import type { D1 } from "./db";

export async function detectCycle(db: D1, taskId: string, dependsOn: string[]): Promise<boolean> {
  if (dependsOn.includes(taskId)) return true;

  for (const depId of dependsOn) {
    const result = await db
      .prepare(`
      WITH RECURSIVE dep_chain(tid) AS (
        SELECT ?
        UNION
        SELECT td.depends_on FROM dep_chain dc
        JOIN task_dependencies td ON td.task_id = dc.tid
      )
      SELECT 1 FROM dep_chain WHERE tid = ? LIMIT 1
    `)
      .bind(depId, taskId)
      .first();

    if (result) return true;
  }

  return false;
}

export async function computeBlocked(db: D1, taskIds: string[]): Promise<Set<string>> {
  if (taskIds.length === 0) return new Set();

  const placeholders = taskIds.map(() => "?").join(",");
  const result = await db
    .prepare(`
    SELECT DISTINCT td.task_id FROM task_dependencies td
    JOIN tasks dep ON dep.id = td.depends_on
    WHERE td.task_id IN (${placeholders}) AND dep.status NOT IN ('done', 'cancelled')
  `)
    .bind(...taskIds)
    .all<{ task_id: string }>();

  return new Set(result.results.map((r: { task_id: string }) => r.task_id));
}

export async function getDependencies(db: D1, taskId: string): Promise<string[]> {
  const result = await db
    .prepare("SELECT depends_on FROM task_dependencies WHERE task_id = ?")
    .bind(taskId)
    .all<{ depends_on: string }>();
  return result.results.map((r: { depends_on: string }) => r.depends_on);
}

export async function setDependencies(db: D1, taskId: string, deps: string[]): Promise<void> {
  const stmts = [
    db.prepare("DELETE FROM task_dependencies WHERE task_id = ?").bind(taskId),
    ...deps.map((depId) =>
      db
        .prepare("INSERT INTO task_dependencies (task_id, depends_on) VALUES (?, ?)")
        .bind(taskId, depId),
    ),
  ];
  await db.batch(stmts);
}
