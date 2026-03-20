import type { Agent } from "@agent-kanban/shared";
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
    "INSERT INTO agents (id, machine_id, name, role_id, created_at) VALUES (?, ?, ?, NULL, ?)"
  ).bind(id, machineId, agentName, now).run();

  return { id, machine_id: machineId, name: agentName, role_id: null, created_at: now };
}
