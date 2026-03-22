import type { Machine, MachineWithAgents, UsageInfo } from "@agent-kanban/shared";
import { MACHINE_STALE_TIMEOUT_MS } from "@agent-kanban/shared";
import { newId, type D1 } from "./db";

export interface CreateMachineInfo {
  name: string;
  os: string;
  version: string;
  runtimes: string[];
}

export interface HeartbeatInfo {
  version?: string;
  runtimes?: string[];
  usage_info?: UsageInfo | null;
}

export async function createMachine(db: D1, ownerId: string, info: CreateMachineInfo): Promise<Machine> {
  const id = newId();
  const now = new Date().toISOString();
  await db.prepare(
    "INSERT INTO machines (id, owner_id, name, os, version, runtimes, status, created_at) VALUES (?, ?, ?, ?, ?, ?, 'offline', ?)"
  ).bind(id, ownerId, info.name, info.os, info.version, JSON.stringify(info.runtimes), now).run();
  return { id, owner_id: ownerId, name: info.name, status: "offline", os: info.os, version: info.version, runtimes: info.runtimes, usage_info: null, last_heartbeat_at: null, created_at: now };
}

export async function deleteMachine(db: D1, machineId: string, ownerId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM machines WHERE id = ? AND owner_id = ?").bind(machineId, ownerId).run();
  return result.meta.changes > 0;
}

export async function heartbeat(
  db: D1,
  machineId: string,
  ownerId: string,
  info: HeartbeatInfo,
): Promise<Machine | null> {
  const now = new Date().toISOString();
  const sets: string[] = ["status = 'online'", "last_heartbeat_at = ?"];
  const binds: any[] = [now];

  if (info.version) { sets.push("version = ?"); binds.push(info.version); }
  if (info.runtimes) { sets.push("runtimes = ?"); binds.push(JSON.stringify(info.runtimes)); }
  if (info.usage_info) { sets.push("usage_info = ?"); binds.push(JSON.stringify(info.usage_info)); }

  binds.push(machineId, ownerId);
  const result = await db.prepare(`UPDATE machines SET ${sets.join(", ")} WHERE id = ? AND owner_id = ?`).bind(...binds).run();
  if (result.meta.changes === 0) return null;

  const row = await db.prepare("SELECT * FROM machines WHERE id = ?").bind(machineId).first<Machine & { usage_info: string | null }>();
  return parseMachineJson(row!);
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
  return result.results.map(parseMachineJson);
}

export async function getMachine(db: D1, machineId: string, ownerId: string): Promise<(MachineWithAgents & { agents: any[] }) | null> {
  await detectStaleMachines(db);

  const machine = await db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id) as agent_count,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id AND a.status = 'working') as active_agent_count
    FROM machines m WHERE m.id = ? AND m.owner_id = ?
  `).bind(machineId, ownerId).first<MachineWithAgents>();

  if (!machine) return null;

  const agents = await db.prepare(`
    SELECT a.id, a.name, a.status,
      (SELECT MAX(tl.created_at) FROM task_logs tl WHERE tl.agent_id = a.id) as last_active_at
    FROM agents a WHERE a.machine_id = ?
    ORDER BY last_active_at DESC
  `).bind(machineId).all();

  return { ...parseMachineJson(machine), agents: agents.results };
}

function parseMachineJson<T extends { runtimes: any; usage_info: any }>(row: T): T {
  if (typeof row.runtimes === "string") {
    try { row.runtimes = JSON.parse(row.runtimes); } catch { row.runtimes = null; }
  }
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
