import type { Agent, AgentWithActivity, CreateAgentInput } from "@agent-kanban/shared";
import { type AgentRuntime, BUILTIN_TEMPLATES, MACHINE_STALE_TIMEOUT_MS } from "@agent-kanban/shared";
import { type D1, parseJsonFields } from "./db";
import { addSubkey, getOrCreateRootKey } from "./gpgKeyRepo";
import { runtimeReadyPredicateSql } from "./machineRepo";

const parseAgent = <T extends Agent>(row: T) => parseJsonFields(row, ["skills", "subagents", "handoff_to"]);

export interface PreparedAgent extends Agent {
  privateKeyJwk: JsonWebKey;
}

export interface AgentIdentity {
  id: string;
  publicKeyBase64: string;
  fingerprint: string;
  privateKeyJwk: JsonWebKey;
}

export async function prepareAgent(
  db: D1,
  ownerId: string,
  input: CreateAgentInput,
  identity: AgentIdentity,
  builtin = false,
): Promise<PreparedAgent> {
  const { id, publicKeyBase64, fingerprint, privateKeyJwk } = identity;
  const now = new Date().toISOString();
  return {
    id,
    owner_id: ownerId,
    name: input.name || input.username,
    username: input.username,
    gpg_subkey_id: null,
    bio: input.bio ?? null,
    soul: input.soul ?? null,
    role: input.role ?? null,
    kind: input.kind ?? "worker",
    handoff_to: input.handoff_to ?? null,
    runtime: input.runtime,
    model: input.model ?? null,
    skills: input.skills ?? null,
    subagents: input.subagents ?? null,
    public_key: publicKeyBase64,
    fingerprint,
    builtin: builtin ? 1 : 0,
    created_at: now,
    updated_at: now,
    privateKeyJwk,
  };
}

export async function insertAgent(db: D1, agent: PreparedAgent, extras?: { mailboxToken?: string; gpgSubkeyId?: string }): Promise<Agent> {
  const skillsJson = agent.skills ? JSON.stringify(agent.skills) : null;
  const subagentsJson = agent.subagents ? JSON.stringify(agent.subagents) : null;
  const handoffJson = agent.handoff_to ? JSON.stringify(agent.handoff_to) : null;
  await db
    .prepare(`
    INSERT INTO agents (id, owner_id, name, username, bio, soul, role, kind, handoff_to, runtime, model, skills, subagents, public_key, private_key, fingerprint, builtin, mailbox_token, gpg_subkey_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
    .bind(
      agent.id,
      agent.owner_id,
      agent.name,
      agent.username,
      agent.bio,
      agent.soul,
      agent.role,
      agent.kind,
      handoffJson,
      agent.runtime,
      agent.model,
      skillsJson,
      subagentsJson,
      agent.public_key,
      JSON.stringify(agent.privateKeyJwk),
      agent.fingerprint,
      agent.builtin,
      extras?.mailboxToken ?? null,
      extras?.gpgSubkeyId ?? null,
      agent.created_at,
      agent.updated_at,
    )
    .run();
  const { privateKeyJwk: _, ...result } = agent;
  if (extras?.gpgSubkeyId) result.gpg_subkey_id = extras.gpgSubkeyId;
  return result;
}

export async function createAgentIdentity(db: D1, ownerId: string, agentEmail: string): Promise<AgentIdentity> {
  await getOrCreateRootKey(db, ownerId);
  const subkey = await addSubkey(db, ownerId, agentEmail);
  if (!subkey) throw new Error("addSubkey returned null after getOrCreateRootKey — should not happen");
  const { x, d } = subkey.privateKeyJwk;
  if (!x || !d) throw new Error("GPG subkey produced invalid JWK — missing x or d field");
  return {
    id: subkey.keyId,
    publicKeyBase64: x,
    fingerprint: subkey.fingerprint,
    privateKeyJwk: subkey.privateKeyJwk,
  };
}

export async function createAgent(db: D1, ownerId: string, input: CreateAgentInput, identity: AgentIdentity, builtin = false): Promise<Agent> {
  const prepared = await prepareAgent(db, ownerId, input, identity, builtin);
  return insertAgent(db, prepared);
}

export async function seedBuiltinAgents(db: D1, ownerId: string): Promise<void> {
  const existing = await db.prepare("SELECT role FROM agents WHERE owner_id = ? AND builtin = 1").bind(ownerId).all<{ role: string }>();
  const existingRoles = new Set(existing.results.map((a) => a.role));

  const hash = Array.from(new TextEncoder().encode(ownerId)).reduce((h, b) => ((h << 5) - h + b) >>> 0, 0);
  const ownerSuffix = hash.toString(36).slice(0, 6);
  for (const tpl of BUILTIN_TEMPLATES) {
    if (tpl.role && existingRoles.has(tpl.role)) continue;
    const username = `${tpl.username ?? tpl.role!}-${ownerSuffix}`;
    const input = { ...tpl, username, runtime: tpl.runtime as AgentRuntime } as CreateAgentInput;
    const identity = await createAgentIdentity(db, ownerId, `${username}@mails.agent-kanban.dev`);
    await createAgent(db, ownerId, input, identity, true);
  }
}

export async function listAgents(db: D1, ownerId: string): Promise<AgentWithActivity[]> {
  const runtimeCutoff = new Date(Date.now() - MACHINE_STALE_TIMEOUT_MS).toISOString();
  const result = await db
    .prepare(`
    SELECT a.id, a.owner_id, a.name, a.username, a.gpg_subkey_id, a.bio, a.soul, a.role, a.kind, a.handoff_to, a.runtime, a.model, a.skills, a.subagents,
      a.public_key, a.fingerprint, a.builtin, a.created_at, a.updated_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM machines m, json_each(m.runtimes) rt
        WHERE m.owner_id = a.owner_id
          AND m.status = 'online'
          AND m.last_heartbeat_at >= ?
          AND ${runtimeReadyPredicateSql("a.runtime")}
      ) THEN 1 ELSE 0 END as runtime_available,
      CASE WHEN EXISTS (SELECT 1 FROM agent_sessions s WHERE s.agent_id = a.id AND s.status = 'active') THEN 'online' ELSE 'offline' END as status,
      (SELECT MAX(tl.created_at) FROM task_actions tl WHERE tl.actor_id = a.id) as last_active_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id) as task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id AND t.status = 'todo') as queued_task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id AND t.status IN ('in_progress', 'in_review')) as active_task_count,
      COALESCE((SELECT SUM(s.input_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as input_tokens,
      COALESCE((SELECT SUM(s.output_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as output_tokens,
      COALESCE((SELECT SUM(s.cache_read_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_read_tokens,
      COALESCE((SELECT SUM(s.cache_creation_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_creation_tokens,
      COALESCE((SELECT SUM(s.cost_micro_usd) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cost_micro_usd
    FROM agents a
    WHERE a.owner_id = ?
    ORDER BY a.created_at DESC
  `)
    .bind(runtimeCutoff, ownerId)
    .all<AgentWithActivity>();
  return result.results.map((r) => ({ ...parseAgent(r), runtime_available: !!r.runtime_available, email: `${r.username}@mails.agent-kanban.dev` }));
}

export async function getAgent(db: D1, agentId: string, ownerId: string): Promise<AgentWithActivity | null> {
  const runtimeCutoff = new Date(Date.now() - MACHINE_STALE_TIMEOUT_MS).toISOString();
  return db
    .prepare(`
    SELECT a.id, a.owner_id, a.name, a.username, a.gpg_subkey_id, a.bio, a.soul, a.role, a.kind, a.handoff_to, a.runtime, a.model, a.skills, a.subagents,
      a.public_key, a.fingerprint, a.builtin, a.created_at, a.updated_at,
      CASE WHEN EXISTS (
        SELECT 1 FROM machines m, json_each(m.runtimes) rt
        WHERE m.owner_id = a.owner_id
          AND m.status = 'online'
          AND m.last_heartbeat_at >= ?
          AND ${runtimeReadyPredicateSql("a.runtime")}
      ) THEN 1 ELSE 0 END as runtime_available,
      CASE WHEN EXISTS (SELECT 1 FROM agent_sessions s WHERE s.agent_id = a.id AND s.status = 'active') THEN 'online' ELSE 'offline' END as status,
      (SELECT MAX(tl.created_at) FROM task_actions tl WHERE tl.actor_id = a.id) as last_active_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id) as task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id AND t.status = 'todo') as queued_task_count,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id AND t.status IN ('in_progress', 'in_review')) as active_task_count,
      COALESCE((SELECT SUM(s.input_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as input_tokens,
      COALESCE((SELECT SUM(s.output_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as output_tokens,
      COALESCE((SELECT SUM(s.cache_read_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_read_tokens,
      COALESCE((SELECT SUM(s.cache_creation_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_creation_tokens,
      COALESCE((SELECT SUM(s.cost_micro_usd) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cost_micro_usd
    FROM agents a
    WHERE a.id = ? AND a.owner_id = ?
  `)
    .bind(runtimeCutoff, agentId, ownerId)
    .first<AgentWithActivity>()
    .then((r) => (r ? { ...parseAgent(r), runtime_available: !!r.runtime_available, email: `${r.username}@mails.agent-kanban.dev` } : null));
}

export async function updateAgent(
  db: D1,
  agentId: string,
  updates: Partial<Pick<Agent, "name" | "bio" | "soul" | "role" | "handoff_to" | "runtime" | "model" | "skills" | "subagents">>,
): Promise<Agent | null> {
  const agent = await db
    .prepare(
      "SELECT id, owner_id, name, username, gpg_subkey_id, bio, soul, role, kind, handoff_to, runtime, model, skills, subagents, public_key, fingerprint, builtin, created_at, updated_at FROM agents WHERE id = ?",
    )
    .bind(agentId)
    .first<Agent>();
  if (!agent) return null;

  const now = new Date().toISOString();
  const sets: string[] = ["updated_at = ?"];
  const binds: unknown[] = [now];
  const applied: Partial<Agent> = {};

  const jsonFields = new Set(["skills", "subagents", "handoff_to"]);
  const fields = ["name", "bio", "soul", "role", "handoff_to", "runtime", "model", "skills", "subagents"] as const;
  for (const field of fields) {
    if (field in updates && (updates as any)[field] !== undefined) {
      sets.push(`${field} = ?`);
      const val = (updates as any)[field];
      binds.push(jsonFields.has(field) && val != null ? JSON.stringify(val) : val);
      (applied as any)[field] = val;
    }
  }

  binds.push(agentId);
  await db
    .prepare(`UPDATE agents SET ${sets.join(", ")} WHERE id = ?`)
    .bind(...binds)
    .run();
  return parseAgent({ ...agent, ...applied, updated_at: now });
}

export async function deleteAgent(db: D1, agentId: string): Promise<boolean> {
  await db.prepare("UPDATE tasks SET assigned_to = NULL WHERE assigned_to = ? AND status IN ('todo', 'in_progress')").bind(agentId).run();
  const result = await db.prepare("DELETE FROM agents WHERE id = ?").bind(agentId).run();
  return result.meta.changes > 0;
}

export async function getAgentLogs(db: D1, agentId: string): Promise<any[]> {
  const result = await db
    .prepare(
      "SELECT tl.*, t.title as task_title FROM task_actions tl JOIN tasks t ON tl.task_id = t.id WHERE tl.actor_id = ? ORDER BY tl.created_at DESC LIMIT 100",
    )
    .bind(agentId)
    .all();
  return result.results;
}

export async function getAgentPrivateKey(db: D1, agentId: string): Promise<JsonWebKey | null> {
  const row = await db.prepare("SELECT private_key FROM agents WHERE id = ?").bind(agentId).first<{ private_key: string }>();
  return row ? JSON.parse(row.private_key) : null;
}

export async function setAgentGpgSubkeyId(db: D1, agentId: string, gpgSubkeyId: string): Promise<void> {
  await db.prepare("UPDATE agents SET gpg_subkey_id = ? WHERE id = ?").bind(gpgSubkeyId, agentId).run();
}

export async function getAgentMailboxToken(db: D1, agentId: string): Promise<string | null> {
  const row = await db.prepare("SELECT mailbox_token FROM agents WHERE id = ?").bind(agentId).first<{ mailbox_token: string | null }>();
  return row?.mailbox_token ?? null;
}
