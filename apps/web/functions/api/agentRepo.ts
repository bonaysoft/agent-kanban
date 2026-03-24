import type { Agent, AgentWithActivity, CreateAgentInput } from '@agent-kanban/shared';
import {
  generateKeypair,
  computeFingerprint,
  computeKeyId,
  BUILTIN_TEMPLATES,
} from '@agent-kanban/shared';
import { parseJsonFields, type D1 } from './db';

const parseAgent = <T extends Agent>(row: T) => parseJsonFields(row, ['skills', 'handoff_to']);

export async function createAgent(
  db: D1,
  ownerId: string,
  input: CreateAgentInput,
  builtin = false,
): Promise<Agent> {
  const { publicKeyBase64, privateKeyJwk } = await generateKeypair();
  const fingerprint = await computeFingerprint(publicKeyBase64);
  const id = computeKeyId(fingerprint);
  const now = new Date().toISOString();
  const skillsJson = input.skills ? JSON.stringify(input.skills) : null;
  const handoffJson = input.handoff_to ? JSON.stringify(input.handoff_to) : null;

  await db
    .prepare(
      `
    INSERT INTO agents (id, owner_id, name, bio, soul, role, handoff_to, runtime, model, skills, public_key, private_key, fingerprint, builtin, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `,
    )
    .bind(
      id,
      ownerId,
      input.name,
      input.bio ?? null,
      input.soul ?? null,
      input.role ?? null,
      handoffJson,
      input.runtime ?? null,
      input.model ?? null,
      skillsJson,
      publicKeyBase64,
      JSON.stringify(privateKeyJwk),
      fingerprint,
      builtin ? 1 : 0,
      now,
      now,
    )
    .run();

  return {
    id,
    owner_id: ownerId,
    name: input.name,
    bio: input.bio ?? null,
    soul: input.soul ?? null,
    role: input.role ?? null,
    handoff_to: input.handoff_to ?? null,
    runtime: input.runtime ?? null,
    model: input.model ?? null,
    skills: input.skills ?? null,
    public_key: publicKeyBase64,
    fingerprint,
    builtin: builtin ? 1 : 0,
    created_at: now,
    updated_at: now,
  };
}

export async function seedBuiltinAgents(db: D1, ownerId: string): Promise<void> {
  const existing = await db
    .prepare('SELECT role FROM agents WHERE owner_id = ? AND builtin = 1')
    .bind(ownerId)
    .all<{ role: string }>();
  const existingRoles = new Set(existing.results.map((a) => a.role));

  for (const tpl of BUILTIN_TEMPLATES) {
    if (tpl.role && existingRoles.has(tpl.role)) continue;
    await createAgent(db, ownerId, tpl, true);
  }
}

export async function listAgents(db: D1, ownerId: string): Promise<AgentWithActivity[]> {
  const result = await db
    .prepare(
      `
    SELECT a.id, a.owner_id, a.name, a.bio, a.soul, a.role, a.handoff_to, a.runtime, a.model, a.skills,
      a.public_key, a.fingerprint, a.builtin, a.created_at, a.updated_at,
      CASE WHEN EXISTS (SELECT 1 FROM agent_sessions s WHERE s.agent_id = a.id AND s.status = 'active') THEN 'online' ELSE 'offline' END as status,
      (SELECT MAX(tl.created_at) FROM task_logs tl WHERE tl.agent_id = a.id) as last_active_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id) as task_count,
      COALESCE((SELECT SUM(s.input_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as input_tokens,
      COALESCE((SELECT SUM(s.output_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as output_tokens,
      COALESCE((SELECT SUM(s.cache_read_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_read_tokens,
      COALESCE((SELECT SUM(s.cache_creation_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_creation_tokens,
      COALESCE((SELECT SUM(s.cost_micro_usd) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cost_micro_usd
    FROM agents a
    WHERE a.owner_id = ?
    ORDER BY a.created_at DESC
  `,
    )
    .bind(ownerId)
    .all<AgentWithActivity>();
  return result.results.map(parseAgent);
}

export async function getAgent(
  db: D1,
  agentId: string,
  ownerId: string,
): Promise<AgentWithActivity | null> {
  return db
    .prepare(
      `
    SELECT a.id, a.owner_id, a.name, a.bio, a.soul, a.role, a.handoff_to, a.runtime, a.model, a.skills,
      a.public_key, a.fingerprint, a.builtin, a.created_at, a.updated_at,
      CASE WHEN EXISTS (SELECT 1 FROM agent_sessions s WHERE s.agent_id = a.id AND s.status = 'active') THEN 'online' ELSE 'offline' END as status,
      (SELECT MAX(tl.created_at) FROM task_logs tl WHERE tl.agent_id = a.id) as last_active_at,
      (SELECT COUNT(*) FROM tasks t WHERE t.assigned_to = a.id) as task_count,
      COALESCE((SELECT SUM(s.input_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as input_tokens,
      COALESCE((SELECT SUM(s.output_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as output_tokens,
      COALESCE((SELECT SUM(s.cache_read_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_read_tokens,
      COALESCE((SELECT SUM(s.cache_creation_tokens) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cache_creation_tokens,
      COALESCE((SELECT SUM(s.cost_micro_usd) FROM agent_sessions s WHERE s.agent_id = a.id), 0) as cost_micro_usd
    FROM agents a
    WHERE a.id = ? AND a.owner_id = ?
  `,
    )
    .bind(agentId, ownerId)
    .first<AgentWithActivity>()
    .then((r) => (r ? parseAgent(r) : null));
}

export async function updateAgent(
  db: D1,
  agentId: string,
  updates: Partial<
    Pick<Agent, 'name' | 'bio' | 'soul' | 'role' | 'handoff_to' | 'runtime' | 'model' | 'skills'>
  >,
): Promise<Agent | null> {
  const agent = await db.prepare('SELECT * FROM agents WHERE id = ?').bind(agentId).first<Agent>();
  if (!agent) return null;

  const now = new Date().toISOString();
  const sets: string[] = ['updated_at = ?'];
  const binds: unknown[] = [now];

  const jsonFields = new Set(['skills', 'handoff_to']);
  const fields = [
    'name',
    'bio',
    'soul',
    'role',
    'handoff_to',
    'runtime',
    'model',
    'skills',
  ] as const;
  for (const field of fields) {
    if (field in updates && (updates as any)[field] !== undefined) {
      sets.push(`${field} = ?`);
      const val = (updates as any)[field];
      binds.push(jsonFields.has(field) && val != null ? JSON.stringify(val) : val);
    }
  }

  binds.push(agentId);
  await db
    .prepare(`UPDATE agents SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();
  return parseAgent({ ...agent, ...updates, updated_at: now });
}

export async function deleteAgent(db: D1, agentId: string): Promise<boolean> {
  const result = await db.prepare('DELETE FROM agents WHERE id = ?').bind(agentId).run();
  return result.meta.changes > 0;
}

export async function getAgentLogs(db: D1, agentId: string): Promise<any[]> {
  const result = await db
    .prepare(
      'SELECT tl.*, t.title as task_title FROM task_logs tl JOIN tasks t ON tl.task_id = t.id WHERE tl.agent_id = ? ORDER BY tl.created_at DESC LIMIT 100',
    )
    .bind(agentId)
    .all();
  return result.results;
}

export async function getAgentPrivateKey(db: D1, agentId: string): Promise<JsonWebKey | null> {
  const row = await db
    .prepare('SELECT private_key FROM agents WHERE id = ?')
    .bind(agentId)
    .first<{ private_key: string }>();
  return row ? JSON.parse(row.private_key) : null;
}
