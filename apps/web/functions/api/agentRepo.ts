import type { Agent, AgentStatus, AgentWithActivity } from "@agent-kanban/shared";
import type { D1 } from "./db";

export async function createAgent(
  db: D1,
  machineId: string,
  agentId: string,
): Promise<Agent> {
  const now = new Date().toISOString();
  const name = `Agent-${agentId.slice(0, 6)}`;

  await db.prepare(
    "INSERT INTO agents (id, machine_id, name, role_id, status, input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_micro_usd, created_at) VALUES (?, ?, ?, NULL, 'idle', 0, 0, 0, 0, 0, ?)"
  ).bind(agentId, machineId, name, now).run();

  return { id: agentId, machine_id: machineId, name, role_id: null, status: "idle", input_tokens: 0, output_tokens: 0, cache_read_tokens: 0, cache_creation_tokens: 0, cost_micro_usd: 0, created_at: now };
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

export interface AgentUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_micro_usd: number;
}

export async function updateAgentUsage(db: D1, agentId: string, usage: AgentUsage): Promise<void> {
  await db.prepare(`
    UPDATE agents SET
      input_tokens = input_tokens + ?,
      output_tokens = output_tokens + ?,
      cache_read_tokens = cache_read_tokens + ?,
      cache_creation_tokens = cache_creation_tokens + ?,
      cost_micro_usd = cost_micro_usd + ?
    WHERE id = ?
  `).bind(
    usage.input_tokens, usage.output_tokens,
    usage.cache_read_tokens, usage.cache_creation_tokens,
    usage.cost_micro_usd, agentId,
  ).run();
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
    WHERE t.assigned_to = ? AND t.status IN ('in_progress', 'in_review')
  `).bind(agentId).first<{ cnt: number }>();

  if (active && active.cnt === 0) {
    await db.prepare("UPDATE agents SET status = 'idle' WHERE id = ?").bind(agentId).run();
  }
}
