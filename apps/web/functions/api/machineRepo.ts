import type { Machine, MachineWithAgents, UsageInfo } from "@agent-kanban/shared";
import { MACHINE_STALE_TIMEOUT_MS } from "@agent-kanban/shared";
import { type D1, newId, parseJsonFields } from "./db";

export interface CreateMachineInfo {
  name: string;
  os: string;
  version: string;
  runtimes: string[];
  device_id: string;
}

export interface HeartbeatInfo {
  version?: string;
  runtimes?: string[];
  usage_info?: UsageInfo | null;
}

export async function upsertMachine(db: D1, ownerId: string, info: CreateMachineInfo): Promise<Machine> {
  const id = newId();
  const now = new Date().toISOString();
  // device_id is the stable hardware fingerprint — never updated after creation
  await db
    .prepare(`INSERT INTO machines (id, owner_id, device_id, name, os, version, runtimes, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'offline', ?)
      ON CONFLICT(owner_id, device_id) DO UPDATE SET name = excluded.name, os = excluded.os, version = excluded.version, runtimes = excluded.runtimes`)
    .bind(id, ownerId, info.device_id, info.name, info.os, info.version, JSON.stringify(info.runtimes), now)
    .run();
  const row = await db.prepare("SELECT * FROM machines WHERE owner_id = ? AND device_id = ?").bind(ownerId, info.device_id).first<Machine>();
  return parseMachine(row!);
}

export async function deleteMachine(db: D1, machineId: string, ownerId: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM machines WHERE id = ? AND owner_id = ?").bind(machineId, ownerId).run();
  return result.meta.changes > 0;
}

export async function updateMachine(db: D1, machineId: string, ownerId: string, info: HeartbeatInfo): Promise<Machine | null> {
  const now = new Date().toISOString();
  const sets: string[] = ["status = 'online'", "last_heartbeat_at = ?"];
  const binds: any[] = [now];

  if (info.version) {
    sets.push("version = ?");
    binds.push(info.version);
  }
  if (info.runtimes) {
    sets.push("runtimes = ?");
    binds.push(JSON.stringify(info.runtimes));
  }
  if (info.usage_info) {
    sets.push("usage_info = ?");
    binds.push(JSON.stringify(info.usage_info));
  }

  binds.push(machineId, ownerId);
  const result = await db
    .prepare(`UPDATE machines SET ${sets.join(", ")} WHERE id = ? AND owner_id = ?`)
    .bind(...binds)
    .run();
  if (result.meta.changes === 0) return null;

  const row = await db.prepare("SELECT * FROM machines WHERE id = ?").bind(machineId).first<Machine>();
  return parseMachine(row!);
}

export async function listMachines(db: D1, ownerId: string): Promise<MachineWithAgents[]> {
  await detectStaleMachines(db);

  const result = await db
    .prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agent_sessions s WHERE s.machine_id = m.id) as session_count,
      (SELECT COUNT(*) FROM agent_sessions s WHERE s.machine_id = m.id AND s.status = 'active') as active_session_count
    FROM machines m
    WHERE m.owner_id = ?
    ORDER BY m.last_heartbeat_at DESC
  `)
    .bind(ownerId)
    .all<MachineWithAgents>();
  return result.results.map(parseMachine);
}

export async function getMachine(db: D1, machineId: string, ownerId: string): Promise<(MachineWithAgents & { agents: any[] }) | null> {
  await detectStaleMachines(db);

  const machine = await db
    .prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agent_sessions s WHERE s.machine_id = m.id) as session_count,
      (SELECT COUNT(*) FROM agent_sessions s WHERE s.machine_id = m.id AND s.status = 'active') as active_session_count
    FROM machines m WHERE m.id = ? AND m.owner_id = ?
  `)
    .bind(machineId, ownerId)
    .first<MachineWithAgents>();

  if (!machine) return null;

  const agents = await db
    .prepare(`
    SELECT a.id, a.name,
      CASE WHEN SUM(s.status = 'active') > 0 THEN 'working' ELSE 'idle' END as status,
      MAX(s.created_at) as last_active_at
    FROM agents a
    JOIN agent_sessions s ON s.agent_id = a.id
    WHERE s.machine_id = ?
    GROUP BY a.id
    ORDER BY last_active_at DESC
  `)
    .bind(machineId)
    .all();

  return { ...parseMachine(machine), agents: agents.results };
}

const parseMachine = <T extends Machine>(row: T) => parseJsonFields(row, ["runtimes", "usage_info"]);

async function detectStaleMachines(db: D1): Promise<void> {
  const cutoff = new Date(Date.now() - MACHINE_STALE_TIMEOUT_MS).toISOString();
  await db.prepare("UPDATE machines SET status = 'offline' WHERE status = 'online' AND last_heartbeat_at < ?").bind(cutoff).run();
}
