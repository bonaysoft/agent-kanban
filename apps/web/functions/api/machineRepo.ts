import type { Machine, MachineWithAgents } from "@agent-kanban/shared";
import { MACHINE_STALE_TIMEOUT_MS } from "@agent-kanban/shared";
import type { D1 } from "./db";

export async function upsertMachineHeartbeat(
  db: D1,
  machineId: string,
  name: string,
): Promise<Machine> {
  const now = new Date().toISOString();

  const existing = await db.prepare(
    "SELECT * FROM machines WHERE id = ?"
  ).bind(machineId).first<Machine>();

  if (existing) {
    await db.prepare(
      "UPDATE machines SET name = ?, status = 'online', last_heartbeat_at = ? WHERE id = ?"
    ).bind(name, now, machineId).run();
    return { ...existing, name, status: "online", last_heartbeat_at: now };
  }

  await db.prepare(
    "INSERT INTO machines (id, name, status, last_heartbeat_at, created_at) VALUES (?, ?, 'online', ?, ?)"
  ).bind(machineId, name, now, now).run();

  return { id: machineId, name, status: "online", last_heartbeat_at: now, created_at: now };
}

export async function listMachines(db: D1): Promise<MachineWithAgents[]> {
  await detectStaleMachines(db);

  const result = await db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id) as agent_count,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id AND a.status = 'working') as active_agent_count
    FROM machines m
    ORDER BY m.last_heartbeat_at DESC
  `).all<MachineWithAgents>();
  return result.results;
}

export async function getMachine(db: D1, machineId: string): Promise<MachineWithAgents | null> {
  await detectStaleMachines(db);

  return db.prepare(`
    SELECT m.*,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id) as agent_count,
      (SELECT COUNT(*) FROM agents a WHERE a.machine_id = m.id AND a.status = 'working') as active_agent_count
    FROM machines m WHERE m.id = ?
  `).bind(machineId).first<MachineWithAgents>();
}

async function detectStaleMachines(db: D1): Promise<void> {
  const cutoff = new Date(Date.now() - MACHINE_STALE_TIMEOUT_MS).toISOString();
  await db.prepare(
    "UPDATE machines SET status = 'offline' WHERE status = 'online' AND last_heartbeat_at < ?"
  ).bind(cutoff).run();
}
