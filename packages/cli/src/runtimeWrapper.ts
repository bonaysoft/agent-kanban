import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type Agent, type AgentRuntime, generateKeypair } from "@agent-kanban/shared";
import { MachineClient } from "./client.js";
import { getCredentials } from "./config.js";
import { loadIdentity, type StoredIdentity, saveIdentity } from "./identity.js";
import { collectUsage } from "./usageCollector.js";

async function ensureIdentity(runtimeName: AgentRuntime, client: MachineClient): Promise<StoredIdentity> {
  const existing = loadIdentity(runtimeName);
  if (existing) return existing;

  // Check server for an existing leader agent with this runtime
  const agents = (await client.listAgents()) as Agent[];
  const match = agents.find((a) => a.runtime === runtimeName && a.kind === "leader");
  if (match) {
    const identity: StoredIdentity = { agent_id: match.id, name: match.name, fingerprint: match.fingerprint };
    saveIdentity(runtimeName, identity);
    console.log(`Restored identity for ${runtimeName}: ${match.id}`);
    return identity;
  }

  console.log(`Creating leader identity for ${runtimeName}...`);
  const agent = (await client.createAgent({ name: runtimeName, runtime: runtimeName, kind: "leader" })) as Agent;
  const identity: StoredIdentity = { agent_id: agent.id, name: agent.name, fingerprint: agent.fingerprint };
  saveIdentity(runtimeName, identity);
  console.log(`  Agent ID:    ${agent.id}`);
  console.log(`  Fingerprint: ${agent.fingerprint}`);
  return identity;
}

export async function wrapRuntime(runtimeName: AgentRuntime, binary: string, args: string[]): Promise<void> {
  let apiUrl: string;
  try {
    apiUrl = getCredentials().apiUrl;
  } catch {
    console.error("No credentials configured. Run: ak start --api-url <url> --api-key <key>");
    process.exit(1);
  }

  const client = new MachineClient();
  const identity = await ensureIdentity(runtimeName, client);

  const { publicKeyBase64, privateKeyJwk } = await generateKeypair();
  const sessionId = randomUUID();
  await client.createSession(identity.agent_id, sessionId, publicKeyBase64);

  const startedAt = Date.now();
  const child = spawn(binary, args, {
    stdio: "inherit",
    env: {
      ...process.env,
      AK_AGENT_ID: identity.agent_id,
      AK_SESSION_ID: sessionId,
      AK_AGENT_KEY: JSON.stringify(privateKeyJwk),
      AK_API_URL: apiUrl,
    },
  });

  child.on("exit", async (code) => {
    try {
      const usage = await collectUsage(runtimeName, startedAt);
      if (usage) await client.updateSessionUsage(identity.agent_id, sessionId, usage);
    } catch (err) {
      console.error(`Failed to report usage for session ${sessionId}:`, err);
    }
    await client.closeSession(identity.agent_id, sessionId).catch((err: unknown) => {
      console.error(`Failed to close session ${sessionId}:`, err);
    });
    process.exit(code ?? 0);
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => child.kill(sig));
  }
}
