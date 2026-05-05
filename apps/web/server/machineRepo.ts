import type { AgentRuntime, Machine, MachineRuntime, MachineRuntimeStatus, MachineWithAgents, UsageInfo } from "@agent-kanban/shared";
import { AGENT_RUNTIMES, MACHINE_STALE_TIMEOUT_MS, normalizeRuntime, RUNTIME_LABELS } from "@agent-kanban/shared";
import { type D1, newId, parseJsonFields } from "./db";

export interface CreateMachineInfo {
  name: string;
  os: string;
  version: string;
  runtimes: MachineRuntime[];
  device_id: string;
}

export interface HeartbeatInfo {
  version?: string;
  runtimes?: MachineRuntime[];
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
    .bind(id, ownerId, info.device_id, info.name, info.os, info.version, JSON.stringify(normalizeMachineRuntimes(info.runtimes, now)), now)
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
    binds.push(JSON.stringify(normalizeMachineRuntimes(info.runtimes, now)));
  }
  if ("usage_info" in info) {
    const usageInfo = info.usage_info;
    sets.push("usage_info = ?");
    binds.push(usageInfo == null ? null : JSON.stringify(normalizeUsageInfo(usageInfo)));
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

export interface AdminMachine extends MachineWithAgents {
  owner_name: string | null;
  owner_email: string | null;
}

export async function listAllMachines(db: D1): Promise<AdminMachine[]> {
  const result = await db
    .prepare(`
    SELECT m.*,
      u.name AS owner_name, u.email AS owner_email,
      (SELECT COUNT(*) FROM agent_sessions s WHERE s.machine_id = m.id) AS session_count,
      (SELECT COUNT(*) FROM agent_sessions s WHERE s.machine_id = m.id AND s.status = 'active') AS active_session_count
    FROM machines m
    LEFT JOIN user u ON u.id = m.owner_id
    ORDER BY m.last_heartbeat_at DESC
  `)
    .all<AdminMachine>();
  return result.results.map(parseMachine);
}

function parseMachine<T extends Machine>(row: T): T {
  const parsed = parseJsonFields(row, ["runtimes", "usage_info"]);
  parsed.runtimes = normalizeMachineRuntimes(parsed.runtimes ?? [], parsed.last_heartbeat_at ?? parsed.created_at);
  if (parsed.usage_info) parsed.usage_info = normalizeUsageInfo(parsed.usage_info);
  return parsed;
}

function normalizeUsageInfo(info: UsageInfo): UsageInfo {
  return {
    ...info,
    windows: info.windows.map((window) => ({
      ...window,
      utilization: window.utilization < 1 ? window.utilization * 100 : window.utilization,
    })),
  };
}

const RUNTIME_BY_LABEL = Object.fromEntries(Object.entries(RUNTIME_LABELS).map(([runtime, label]) => [label, runtime])) as Record<
  string,
  AgentRuntime
>;

export function runtimeMatchValues(runtime: string): string[] {
  const normalized = normalizeRuntime(runtime);
  const canonical = (RUNTIME_BY_LABEL[normalized] ?? normalized) as AgentRuntime;
  const label = RUNTIME_LABELS[canonical];
  return label && label !== canonical ? [canonical, label] : [canonical];
}

export function runtimeReadyPredicateSql(runtimeExpr: string): string {
  return `
    (
      (
        rt.type = 'text'
        AND (rt.value = ${runtimeExpr} OR rt.value = ${runtimeLabelCaseSql(runtimeExpr)})
      )
      OR (
        json_extract(rt.value, '$.status') = 'ready'
        AND json_extract(rt.value, '$.name') = ${runtimeExpr}
      )
    )
  `;
}

function runtimeLabelCaseSql(runtimeExpr: string): string {
  const cases = Object.entries(RUNTIME_LABELS)
    .map(([runtime, label]) => `WHEN '${runtime}' THEN '${label.replace(/'/g, "''")}'`)
    .join(" ");
  return `CASE ${runtimeExpr} ${cases} END`;
}

const RUNTIME_STATUSES: readonly MachineRuntimeStatus[] = ["missing", "unauthorized", "unhealthy", "limited", "ready"];

export function normalizeMachineRuntimes(runtimes: MachineRuntime[] | string[], checkedAt: string): MachineRuntime[] {
  return runtimes.map((runtime) => {
    if (typeof runtime === "string") {
      return { name: normalizeMachineRuntimeName(runtime), status: "ready", checked_at: checkedAt };
    }
    const name = normalizeMachineRuntimeName(runtime.name);
    if (!RUNTIME_STATUSES.includes(runtime.status)) {
      throw new Error(`Invalid runtime status "${runtime.status}"`);
    }
    return {
      name,
      status: runtime.status,
      ...(runtime.detail ? { detail: runtime.detail } : {}),
      ...(runtime.reset_at ? { reset_at: runtime.reset_at } : {}),
      checked_at: runtime.checked_at || checkedAt,
    };
  });
}

function normalizeMachineRuntimeName(runtime: string): AgentRuntime {
  const normalized = normalizeRuntime(runtime);
  const canonical = RUNTIME_BY_LABEL[normalized] ?? normalized;
  if (!AGENT_RUNTIMES.includes(canonical as AgentRuntime)) {
    throw new Error(`Invalid runtime "${runtime}"`);
  }
  return canonical as AgentRuntime;
}

export async function isRuntimeAvailable(db: D1, ownerId: string, runtime: string): Promise<boolean> {
  const cutoff = new Date(Date.now() - MACHINE_STALE_TIMEOUT_MS).toISOString();
  const values = runtimeMatchValues(runtime);
  const placeholders = values.map(() => "?").join(", ");
  const row = await db
    .prepare(`
      SELECT 1
      FROM machines m, json_each(m.runtimes) rt
      WHERE m.owner_id = ?
        AND m.status = 'online'
        AND m.last_heartbeat_at >= ?
        AND (
          (rt.type = 'text' AND rt.value IN (${placeholders}))
          OR (
            json_extract(rt.value, '$.status') = 'ready'
            AND json_extract(rt.value, '$.name') IN (${placeholders})
          )
        )
      LIMIT 1
    `)
    .bind(ownerId, cutoff, ...values, ...values)
    .first();
  return !!row;
}

export async function detectStaleMachines(db: D1): Promise<void> {
  const cutoff = new Date(Date.now() - MACHINE_STALE_TIMEOUT_MS).toISOString();
  await db.prepare("UPDATE machines SET status = 'offline' WHERE status = 'online' AND last_heartbeat_at < ?").bind(cutoff).run();
}
