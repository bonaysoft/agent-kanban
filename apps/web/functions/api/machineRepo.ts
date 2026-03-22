import type { Machine, MachineWithAgents, UsageInfo } from "@agent-kanban/shared";
import { MACHINE_STALE_TIMEOUT_MS } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export interface HeartbeatInfo {
  name: string;
  os?: string;
  version?: string;
  runtimes?: string[];
  usage_info?: UsageInfo | null;
}

export async function createMachine(db: D1, ownerId: string, name: string): Promise<Machine> {
  const id = newId();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO machines (id, owner_id, name, status, created_at) VALUES (?, ?, ?, 'offline', ?)"
  ).bind(id, ownerId, name, now).run();
  return { id, owner_id: ownerId, name, status: "offline", os: null, version: null, runtimes: null, usage_info: null, last_heartbeat_at: null, created_at: now };
}

export async function deleteMachine(db: D1, machineId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM machines WHERE id = ?").bind(machineId).run();
  return result.meta.changes > 0;
}

export async function upsertMachineHeartbeat(
  db: D1,
  machineId: string,
  info: HeartbeatInfo,
): Promise<Machine> {
  const now = new Date().toISOString();
  const runtimesStr = info.runtimes?.join(",") || null;
  const usageStr = info.usage_info ? JSON.stringify(info.usage_info) : null;

  await db.prepare(
    "UPDATE machines SET name = ?, os = ?, version = ?, runtimes = ?, usage_info = ?, status = 'online', last_heartbeat_at = ? WHERE id = ?"
  ).bind(info.name, info.os || null, info.version || null, runtimesStr, usageStr, now, machineId).run();

  const row = await db.prepare("SELECT * FROM machines WHERE id = ?").bind(machineId).first<Machine & { usage_info: string | null }>();
  return parseMachineUsage(row!);
}

export async function listMachines(db: D1, ownerId: string): Promise<MachineWithAgents[]> {
  await detectStaleMachines(db);

  const result = await db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id) as agent_count,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id AND a.status = 'working') as active_agent_count
    FROM machines m
    WHERE m.owner_id = ?
    ORDER BY m.last_heartbeat_at DESC
  `).bind(ownerId).all<MachineWithAgents>();
  return result.results.map(parseMachineUsage);
}

export async function getMachine(db: D1, machineId: string): Promise<(MachineWithAgents & { agents: any[] }) | null> {
  await detectStaleMachines(db);

  const machine = await db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id) as agent_count,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id AND a.status = 'working') as active_agent_count
    FROM machines m WHERE m.id = ?
  `).bind(machineId).first<MachineWithAgents>();

  if (!machine) return null;

  const agents = await db.prepare(`
    SELECT a.id, a.name, a.status,
      (SELECT MAX(tl.created_at) FROM task_logs tl WHERE tl.agent_id = a.id) as last_active_at
    FROM agents a WHERE a.machine_id = ?
    ORDER BY last_active_at DESC
  `).bind(machineId).all();

  return { ...parseMachineUsage(machine), agents: agents.results };
}

function parseMachineUsage<T extends { usage_info: any }>(row: T): T {
  if (typeof row.usage_info === "string") {
    try { row.usage_info = JSON.parse(row.usage_info); } catch { row.usage_info = null; }
  }
  return row;
}

async function detectStaleMachines(db: D1): Promise<void> {
  const cutoff = new Date(Date.now() - MACHINE_STALE_TIMEOUT_MS).toISOString();
  await db.prepare(
    "UPDATE machines SET status = 'offline' WHERE status = 'online' AND last_heartbeat_at < ?"
  ).bind(cutoff).run();
}
