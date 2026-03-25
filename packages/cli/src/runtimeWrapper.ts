import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type Agent, generateKeypair } from "@agent-kanban/shared";
import { MachineClient } from "./client.js";
import { getConfigValue } from "./config.js";
import { loadIdentity, type StoredIdentity, saveIdentity } from "./identity.js";

async function ensureIdentity(runtimeName: string, client: MachineClient): Promise<StoredIdentity> {
  const existing = loadIdentity(runtimeName);
  if (existing) return existing;

  console.log(`Creating leader identity for ${runtimeName}...`);
  const agent = (await client.createAgent({ name: `${runtimeName}-leader`, runtime: runtimeName, kind: "leader" })) as Agent;
  const identity: StoredIdentity = { agent_id: agent.id, name: agent.name, fingerprint: agent.fingerprint };
  saveIdentity(runtimeName, identity);
  console.log(`  Agent ID:    ${agent.id}`);
  console.log(`  Fingerprint: ${agent.fingerprint}`);
  return identity;
}

export async function wrapRuntime(runtimeName: string, binary: string, args: string[]): Promise<void> {
  const apiUrl = getConfigValue("api-url");
  if (!apiUrl) {
    console.error("API URL not configured. Run: ak config set api-url <url>");
    process.exit(1);
  }

  const client = new MachineClient();
  const identity = await ensureIdentity(runtimeName, client);

  const { publicKeyBase64, privateKeyJwk } = await generateKeypair();
  const sessionId = randomUUID();
  await client.createSession(identity.agent_id, sessionId, publicKeyBase64);

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
    await client.closeSession(identity.agent_id, sessionId).catch((err: unknown) => {
      console.error(`Failed to close session ${sessionId}:`, err);
    });
    process.exit(code ?? 0);
  });

  for (const sig of ["SIGINT", "SIGTERM"] as const) {
    process.once(sig, () => child.kill(sig));
  }
}
