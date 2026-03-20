import type { D1 } from "./db";

export async function detectCycle(db: D1, taskId: string, dependsOn: string[]): Promise<boolean> {
  if (dependsOn.includes(taskId)) return true;

  // Use recursive CTE to walk the dependency graph from each dep
  // If we ever reach taskId, there's a cycle
  for (const depId of dependsOn) {
    const result = await db.prepare(`
      WITH RECURSIVE dep_chain(tid) AS (
        SELECT ?
        UNION
        SELECT je.value FROM dep_chain dc
        JOIN tasks t ON t.id = dc.tid
        JOIN json_each(t.depends_on) je
        WHERE t.depends_on IS NOT NULL
      )
      SELECT 1 FROM dep_chain WHERE tid = ? LIMIT 1
    `).bind(depId, taskId).first();

    if (result) return true;
  }

  return false;
}

export async function computeBlocked(db: D1, taskIds: string[]): Promise<Set<string>> {
  const blocked = new Set<string>();

  for (const taskId of taskIds) {
    const task = await db.prepare("SELECT depends_on FROM tasks WHERE id = ?").bind(taskId).first<{ depends_on: string | null }>();
    if (!task?.depends_on) continue;

    const deps: string[] = JSON.parse(task.depends_on);
    if (deps.length === 0) continue;

    // Check if any dependency is NOT in a Done column
    const placeholders = deps.map(() => "?").join(",");
    const undone = await db.prepare(`
      SELECT t.id FROM tasks t
      JOIN columns c ON t.column_id = c.id
      WHERE t.id IN (${placeholders}) AND c.name NOT IN ('Done', 'Cancelled')
      LIMIT 1
    `).bind(...deps).first();

    if (undone) blocked.add(taskId);
  }

  return blocked;
}
