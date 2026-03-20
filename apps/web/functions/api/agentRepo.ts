import type { Agent, AgentStatus, AgentWithActivity } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export async function findOrCreateAgent(
  db: D1,
  machineId: string,
  agentName: string,
): Promise<Agent> {
  const existing = await db.prepare(
    "SELECT * FROM agents WHERE machine_id = ? AND name = ?"
  ).bind(machineId, agentName).first<Agent>();

  if (existing) return existing;

  const id = newId();
  const now = new Date().toISOString();

  await db.prepare(
    "INSERT INTO agents (id, machine_id, name, role_id, status, created_at) VALUES (?, ?, ?, NULL, 'idle', ?)"
  ).bind(id, machineId, agentName, now).run();

  return { id, machine_id: machineId, name: agentName, role_id: null, status: "idle", created_at: now };
}

export async function listAgents(db: D1): Promise<AgentWithActivity[]> {
  const result = await db.prepare(`
    SELECT a.*,
      (SELECT MAX(tl.created_at) FROM task_logs tl WHERE tl.agent_id = a.id) as last_active_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id) as task_count
    FROM agents a
    ORDER BY a.created_at DESC
  `).all<AgentWithActivity>();
  return result.results;
}

export async function getAgent(db: D1, agentId: string): Promise<AgentWithActivity | null> {
  return db.prepare(`
    SELECT a.*,
      (SELECT MAX(tl.created_at) FROM task_logs tl WHERE tl.agent_id = a.id) as last_active_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id) as task_count
    FROM agents a WHERE a.id = ?
  `).bind(agentId).first<AgentWithActivity>();
}

export async function getAgentLogs(db: D1, agentId: string): Promise<any[]> {
  const result = await db.prepare(
    "SELECT tl.*, t.title as task_title FROM task_logs tl JOIN tasks t ON tl.task_id = t.id WHERE tl.agent_id = ? ORDER BY tl.created_at DESC LIMIT 100"
  ).bind(agentId).all();
  return result.results;
}

export async function updateAgentStatus(db: D1, agentId: string, status: AgentStatus): Promise<void> {
  await db.prepare("UPDATE agents SET status = ? WHERE id = ?").bind(status, agentId).run();
}

export async function setAgentWorkingIfIdle(db: D1, agentId: string): Promise<void> {
  await db.prepare("UPDATE agents SET status = 'working' WHERE id = ? AND status = 'idle'").bind(agentId).run();
}

export async function setAgentIdleIfNoActiveTasks(db: D1, agentId: string): Promise<void> {
  const active = await db.prepare(`
    SELECT COUNT(*) as cnt FROM tasks t
    JOIN columns c ON t.column_id = c.id
    WHERE t.assigned_to = ? AND c.name IN ('In Progress', 'In Review')
  `).bind(agentId).first<{ cnt: number }>();

  if (active && active.cnt === 0) {
    await db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").bind(agentId).run();
  }
}
