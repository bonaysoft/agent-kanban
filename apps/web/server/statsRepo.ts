import type { D1 } from "./db";

export interface SystemStats {
  users: { total: number; recent: number };
  agents: { total: number; online: number };
  tasks: { todo: number; in_progress: number; in_review: number; done: number; cancelled: number };
  boards: { total: number };
  machines: { total: number; online: number };
}

type CountRow = { "COUNT(*)": number };
type TaskStatusRow = { status: string; count: number };

export async function getSystemStats(db: D1): Promise<SystemStats> {
  const [usersTotal, usersRecent, agentsTotal, agentsOnline, tasksByStatus, boardsTotal, machinesTotal, machinesOnline] = await db.batch([
    db.prepare("SELECT COUNT(*) FROM user"),
    db.prepare("SELECT COUNT(*) FROM user WHERE createdAt > datetime('now', '-7 days')"),
    db.prepare("SELECT COUNT(*) FROM agents"),
    db.prepare(
      "SELECT COUNT(*) FROM agents WHERE EXISTS (SELECT 1 FROM agent_sessions WHERE agent_sessions.agent_id = agents.id AND agent_sessions.status = 'active')",
    ),
    db.prepare("SELECT status, COUNT(*) as count FROM tasks GROUP BY status"),
    db.prepare("SELECT COUNT(*) FROM boards"),
    db.prepare("SELECT COUNT(*) FROM machines"),
    db.prepare("SELECT COUNT(*) FROM machines WHERE status = 'online'"),
  ]);

  const taskCounts = { todo: 0, in_progress: 0, in_review: 0, done: 0, cancelled: 0 };
  for (const row of tasksByStatus.results as TaskStatusRow[]) {
    const s = row.status as keyof typeof taskCounts;
    if (s in taskCounts) taskCounts[s] = row.count;
  }

  return {
    users: {
      total: (usersTotal.results[0] as CountRow)["COUNT(*)"],
      recent: (usersRecent.results[0] as CountRow)["COUNT(*)"],
    },
    agents: {
      total: (agentsTotal.results[0] as CountRow)["COUNT(*)"],
      online: (agentsOnline.results[0] as CountRow)["COUNT(*)"],
    },
    tasks: taskCounts,
    boards: {
      total: (boardsTotal.results[0] as CountRow)["COUNT(*)"],
    },
    machines: {
      total: (machinesTotal.results[0] as CountRow)["COUNT(*)"],
      online: (machinesOnline.results[0] as CountRow)["COUNT(*)"],
    },
  };
}
