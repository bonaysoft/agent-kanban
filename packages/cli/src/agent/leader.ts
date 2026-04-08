import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import type { Agent, AgentRuntime } from "@agent-kanban/shared";
import { AgentClient } from "../client/agent.js";
import type { ApiClient } from "../client/base.js";
import { MachineClient } from "../client/machine.js";
import { getCredentials } from "../config.js";
import { PID_FILE } from "../paths.js";
import { findLeaderSession, isPidAlive, writeSession } from "../session/store.js";
import { loadIdentity, type StoredIdentity, saveIdentity } from "./identity.js";
import { detectRuntime, findRuntimeAncestorPid } from "./runtime.js";

function isDaemonAlive(): boolean {
  try {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function ensureIdentity(runtime: AgentRuntime, client: MachineClient): Promise<StoredIdentity> {
  const existing = loadIdentity(runtime);
  if (existing) return existing;

  const agents = (await client.listAgents()) as Agent[];
  const match = agents.find((a) => a.runtime === runtime && a.kind === "leader");
  if (match) {
    const identity: StoredIdentity = { agent_id: match.id, name: match.name, fingerprint: match.fingerprint };
    saveIdentity(runtime, identity);
    return identity;
  }

  const agent = (await client.createAgent({ name: runtime, runtime, kind: "leader" })) as Agent;
  const identity: StoredIdentity = { agent_id: agent.id, name: agent.name, fingerprint: agent.fingerprint };
  saveIdentity(runtime, identity);
  return identity;
}

let cachedLeaderClient: AgentClient | null = null;

/**
 * Returns AgentClient for the current identity.
 * - Daemon-spawned workers: reads AK_AGENT_* env vars
 * - Leader agents: auto-initializes from runtime detection + session file
 * - No runtime: throws (human in terminal)
 */
export async function createClient(): Promise<ApiClient> {
  const fromEnv = await AgentClient.fromEnv();
  if (fromEnv) return fromEnv;

  if (cachedLeaderClient) return cachedLeaderClient;

  const runtime = detectRuntime() as AgentRuntime | null;
  if (!runtime) {
    throw new Error("This command requires agent identity. Run inside an agent runtime.");
  }

  // Anchor the leader session to the long-lived runtime process PID so it outlives
  // the ephemeral shell that spawns `ak`. Without this, every ak invocation would
  // create a fresh session that the daemon's heartbeat immediately reaps.
  const leaderPid = findRuntimeAncestorPid(runtime);
  if (leaderPid === null) {
    throw new Error(`Could not locate ${runtime} process in ancestry. ak must be invoked from inside a ${runtime} session.`);
  }

  const existing = findLeaderSession(leaderPid);
  if (existing && existing.runtime === runtime && isPidAlive(leaderPid)) {
    const key = await crypto.subtle.importKey("jwk", existing.privateKeyJwk, { name: "Ed25519" } as any, false, ["sign"]);
    cachedLeaderClient = new AgentClient(existing.apiUrl, existing.agentId, existing.sessionId, key);
    return cachedLeaderClient;
  }

  if (!isDaemonAlive()) {
    throw new Error("Daemon is not running. Start it with: ak start");
  }

  // First call — auto-init leader session
  const machineClient = new MachineClient();
  const identity = await ensureIdentity(runtime, machineClient);
  const { publicKey, privateKey } = (await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"])) as CryptoKeyPair;
  const pubJwk = await crypto.subtle.exportKey("jwk", publicKey);
  const privJwk = await crypto.subtle.exportKey("jwk", privateKey);
  if (!pubJwk.x) throw new Error("Ed25519 key export missing x component");
  const sessionId = randomUUID();
  const apiUrl = getCredentials().apiUrl;
  await machineClient.createSession(identity.agent_id, sessionId, pubJwk.x);

  writeSession({
    type: "leader",
    agentId: identity.agent_id,
    sessionId,
    pid: leaderPid,
    runtime,
    startedAt: Date.now(),
    apiUrl,
    privateKeyJwk: privJwk,
  });

  cachedLeaderClient = new AgentClient(apiUrl, identity.agent_id, sessionId, privateKey);
  return cachedLeaderClient;
}
