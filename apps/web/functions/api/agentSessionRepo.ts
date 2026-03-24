import type {
  AgentSession,
  AgentSessionWithMachine,
  SessionUsageInput,
} from '@agent-kanban/shared';
import { signDelegation } from '@agent-kanban/shared';
import type { D1 } from './db';
import { getAgentPrivateKey } from './agentRepo';
import { createAuth } from './betterAuth';
import type { Env } from './types';

export async function createSession(
  db: D1,
  env: Env,
  agentId: string,
  machineId: string,
  sessionId: string,
  sessionPublicKey: string,
  ownerId: string,
): Promise<{ delegation_proof: string }> {
  const agentPrivateKey = await getAgentPrivateKey(db, agentId);
  if (!agentPrivateKey) throw new Error('Agent not found');

  const delegationProof = await signDelegation(agentPrivateKey, sessionPublicKey);
  const now = new Date().toISOString();

  await db
    .prepare(
      `
    INSERT INTO agent_sessions (id, agent_id, machine_id, status, public_key, delegation_proof, created_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `,
    )
    .bind(sessionId, agentId, machineId, sessionPublicKey, delegationProof, now)
    .run();

  // Register in Better Auth agent table for JWT verification
  const auth = createAuth(env);
  const authCtx = await auth.$context;

  // Ensure agentHost exists for this machine
  const existingHost = await authCtx.adapter.findOne({
    model: 'agentHost',
    where: [{ field: 'id', value: machineId }],
  });
  if (!existingHost) {
    await authCtx.adapter.create({
      model: 'agentHost',
      data: {
        id: machineId,
        name: `machine-${machineId.slice(0, 8)}`,
        userId: ownerId,
        status: 'active',
        activatedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      forceAllowId: true,
    });
  }

  const jwk = JSON.stringify({ kty: 'OKP', crv: 'Ed25519', x: sessionPublicKey });
  await authCtx.adapter.create({
    model: 'agent',
    data: {
      id: sessionId,
      name: `session-${sessionId.slice(0, 8)}`,
      userId: ownerId,
      hostId: machineId,
      status: 'active',
      mode: 'autonomous',
      publicKey: jwk,
      activatedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    },
    forceAllowId: true,
  });

  const capabilities = ['task:claim', 'task:review', 'task:log', 'task:message', 'agent:usage'];
  for (const cap of capabilities) {
    await authCtx.adapter.create({
      model: 'agentCapabilityGrant',
      data: {
        agentId: sessionId,
        capability: cap,
        grantedBy: ownerId,
        deniedBy: null,
        expiresAt: null,
        status: 'active',
        reason: null,
        constraints: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  return { delegation_proof: delegationProof };
}

export async function getSession(db: D1, sessionId: string): Promise<AgentSession | null> {
  return db
    .prepare('SELECT * FROM agent_sessions WHERE id = ?')
    .bind(sessionId)
    .first<AgentSession>();
}

export async function closeSession(db: D1, sessionId: string): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare("UPDATE agent_sessions SET status = 'closed', closed_at = ? WHERE id = ?")
    .bind(now, sessionId)
    .run();
}

export async function reopenSession(db: D1, sessionId: string): Promise<void> {
  const result = await db
    .prepare(
      "UPDATE agent_sessions SET status = 'active', closed_at = NULL WHERE id = ? AND status = 'closed'",
    )
    .bind(sessionId)
    .run();
  if (!result.meta.changes) throw new Error(`Session ${sessionId} not found or not closed`);
}

export async function updateSessionUsage(
  db: D1,
  sessionId: string,
  usage: SessionUsageInput,
): Promise<void> {
  await db
    .prepare(
      `
    UPDATE agent_sessions SET
      input_tokens = input_tokens + ?,
      output_tokens = output_tokens + ?,
      cache_read_tokens = cache_read_tokens + ?,
      cache_creation_tokens = cache_creation_tokens + ?,
      cost_micro_usd = cost_micro_usd + ?
    WHERE id = ?
  `,
    )
    .bind(
      usage.input_tokens,
      usage.output_tokens,
      usage.cache_read_tokens,
      usage.cache_creation_tokens,
      usage.cost_micro_usd,
      sessionId,
    )
    .run();
}

export async function listSessions(db: D1, agentId: string): Promise<AgentSessionWithMachine[]> {
  const result = await db
    .prepare(
      `
    SELECT s.*, m.name as machine_name
    FROM agent_sessions s
    JOIN machines m ON s.machine_id = m.id
    WHERE s.agent_id = ?
    ORDER BY s.created_at DESC
  `,
    )
    .bind(agentId)
    .all<AgentSessionWithMachine>();
  return result.results;
}
