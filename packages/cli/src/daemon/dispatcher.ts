/**
 * Dispatcher — full task dispatch pipeline + agent environment/GPG helpers.
 *
 * Fetches todo tasks, filters by availability and rate-limit state,
 * resolves runtime, prepares repo, and spawns the agent. Also provides
 * buildAgentEnv / setupGnupgHome / cleanupGnupgHome used by resumer.
 */

import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type BoardType, isBoardType } from "@agent-kanban/shared";
import { type AgentInfo, generateSystemPrompt, writePromptFile } from "../agent/systemPrompt.js";
import { AgentClient, type ApiClient } from "../client/index.js";
import { getCredentials } from "../config.js";
import { createLogger } from "../logger.js";
import { getProvider, normalizeRuntime } from "../providers/registry.js";
import { getSessionManager } from "../session/manager.js";
import type { SessionFile } from "../session/types.js";
import { ensureCloned, prepareRepo, repoDir } from "../workspace/repoOps.js";
import { ensureLefthookTask, ensureSkills } from "../workspace/skills.js";
import { createRepoWorkspace, createTempWorkspace } from "../workspace/workspace.js";
import { apiCall, apiCallIdempotent, apiCallOptional, cryptoBoundary, execBoundary, fsSync } from "./boundaries.js";
import type { PrMonitor } from "./prMonitor.js";
import type { RateLimiter } from "./rateLimiter.js";
import type { RuntimePool } from "./runtimePool.js";

const logger = createLogger("dispatcher");

// ---- Agent environment / GPG helpers ----

export interface BuildEnvOpts {
  agentId: string;
  sessionId: string;
  privateKeyJwk: JsonWebKey;
  agentName: string;
  agentUsername: string;
  gpgSubkeyId: string | null;
  gnupgHome: string | null;
}

export function buildAgentEnv(opts: BuildEnvOpts): Record<string, string> {
  const { agentId, sessionId, privateKeyJwk, agentName, agentUsername, gpgSubkeyId, gnupgHome } = opts;
  const email = `${agentUsername}@mails.agent-kanban.dev`;
  const env: Record<string, string> = {
    AK_AGENT_ID: agentId,
    AK_SESSION_ID: sessionId,
    AK_AGENT_KEY: JSON.stringify(privateKeyJwk),
    AK_API_URL: getCredentials().apiUrl,
    GIT_AUTHOR_NAME: agentName,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: agentName,
    GIT_COMMITTER_EMAIL: email,
  };
  if (gnupgHome && gpgSubkeyId) {
    env.GNUPGHOME = gnupgHome;
    env.GIT_CONFIG_COUNT = "3";
    env.GIT_CONFIG_KEY_0 = "gpg.format";
    env.GIT_CONFIG_VALUE_0 = "openpgp";
    env.GIT_CONFIG_KEY_1 = "user.signingkey";
    env.GIT_CONFIG_VALUE_1 = `${gpgSubkeyId}!`;
    env.GIT_CONFIG_KEY_2 = "commit.gpgsign";
    env.GIT_CONFIG_VALUE_2 = "true";
  }
  return env;
}

export function setupGnupgHome(armoredPrivateKey: string): string {
  const gnupgHome = fsSync("mkdtemp-gpg", () => mkdtempSync(join(tmpdir(), "ak-gpg-")));
  const keyFile = join(gnupgHome, "key.asc");
  fsSync("write-gpg-key", () => writeFileSync(keyFile, armoredPrivateKey, { mode: 0o600 }));
  execBoundary("gpg-import", () =>
    execFileSync("gpg", ["--batch", "--import", keyFile], {
      env: { ...process.env, GNUPGHOME: gnupgHome },
      stdio: "pipe",
    }),
  );
  fsSync("rm-gpg-keyfile", () => rmSync(keyFile));
  return gnupgHome;
}

export function cleanupGnupgHome(gnupgHome: string | null): void {
  if (!gnupgHome) return;
  fsSync("rm-gnupghome", () => rmSync(gnupgHome, { recursive: true, force: true }));
}

// ---- Dispatch pipeline ----

export interface DispatchOpts {
  maxConcurrent: number;
  pollInterval: number;
}

/**
 * Fetch todo tasks, filter, resolve runtime, prepare repo, dispatch one.
 * Returns true if a task was dispatched.
 */
export async function dispatchTasks(
  client: ApiClient,
  pool: RuntimePool,
  rateLimiter: RateLimiter,
  prMonitor: PrMonitor,
  opts: DispatchOpts,
): Promise<boolean> {
  const tasks = (await client.listTasks({ status: "todo" })) as any[];
  const repos = await client.listRepositories();
  const repoById = new Map(repos.map((r: any) => [r.id, r]));

  for (const t of tasks) {
    if (t.blocked || !t.assigned_to || pool.hasTask(t.id) || !t.repository_id) continue;
    const repo = repoById.get(t.repository_id);
    if (repo) ensureCloned(repo);
  }

  const now = new Date().toISOString();
  const available = tasks.filter((t: any) => {
    if (t.blocked || !t.assigned_to || pool.hasTask(t.id)) return false;
    if (t.scheduled_at && t.scheduled_at > now) return false;
    if (!t.repository_id) {
      if (t.board_type === "dev") {
        logger.warn(`Dev task ${t.id} has no repository_id, skipping`);
        return false;
      }
      return true;
    }
    const repo = repoById.get(t.repository_id);
    return repo && repoDir(repo.url) !== null;
  });

  if (available.length === 0) return false;

  const agentCache = new Map<string, string>();
  let task: any = null;
  for (const t of available) {
    let runtime = agentCache.get(t.assigned_to);
    if (runtime === undefined) {
      const agent = (await apiCallOptional("getAgent", () => client.getAgent(t.assigned_to))) as any;
      if (!agent) {
        logger.warn(`Agent ${t.assigned_to} not found, skipping task ${t.id}`);
        agentCache.set(t.assigned_to, "");
        continue;
      }
      runtime = normalizeRuntime(agent.runtime ?? "claude");
      agentCache.set(t.assigned_to, runtime);
    }
    if (!runtime) continue;
    if (!rateLimiter.isRuntimePaused(runtime)) {
      task = t;
      break;
    }
  }

  if (!task) return false;

  let dir: string | null = null;
  if (task.repository_id) {
    const repo = repoById.get(task.repository_id)!;
    dir = repoDir(repo.url);

    if (!prepareRepo(dir)) {
      logger.error(`Repo not ready at ${dir}, skipping task ${task.id}`);
      return false;
    }

    if (await ensureLefthookTask(client as any, task, dir, tasks)) {
      return false;
    }
  }

  const boardType = task.board_type;
  if (!isBoardType(boardType)) {
    logger.error(`Task ${task.id} has invalid board_type "${boardType}", skipping`);
    return false;
  }

  const dispatched = await dispatchOne(task, dir, boardType, client, pool);
  if (dispatched) prMonitor.track(task.id);
  return dispatched;
}

/**
 * Single task dispatch: session create -> keys -> workspace -> skills -> env -> spawn.
 */
async function dispatchOne(task: any, repoDir: string | null, boardType: BoardType, client: ApiClient, pool: RuntimePool): Promise<boolean> {
  const agentId = task.assigned_to;
  const sessionId = randomUUID();

  const { publicKey, privateKey } = (await cryptoBoundary("generateKey", () =>
    crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]),
  )) as CryptoKeyPair;
  const pubKeyJwk = await cryptoBoundary("exportPubKey", () => crypto.subtle.exportKey("jwk", publicKey));
  const privKeyJwk = (await cryptoBoundary("exportPrivKey", () => crypto.subtle.exportKey("jwk", privateKey))) as JsonWebKey;

  const created = await apiCallIdempotent("createSession", () => client.createSession(agentId, sessionId, (pubKeyJwk as JsonWebKey).x!));
  if (!created) return false;

  logger.info(`Session ${sessionId.slice(0, 8)} for agent ${agentId} on task ${task.id}: ${task.title}`);

  const abort = async () => {
    await apiCallOptional("releaseTask", () => client.releaseTask(task.id));
    await apiCallOptional("closeSession", () => client.closeSession(agentId, sessionId));
  };

  const agentDetails = (await apiCallOptional("getAgent", () => client.getAgent(agentId))) as AgentInfo | null;
  if (!agentDetails) {
    logger.error(`Agent ${agentId} not found, releasing task ${task.id}`);
    await abort();
    return false;
  }

  const gpgSubkeyId = (agentDetails as any).gpg_subkey_id ?? null;
  let gnupgHome: string | null = null;
  if (gpgSubkeyId) {
    const gpgData = (await apiCallOptional("getAgentGpgKey", () => client.getAgentGpgKey(agentId))) as { armored_private_key: string } | null;
    if (gpgData) gnupgHome = setupGnupgHome(gpgData.armored_private_key);
  }

  let workspace: { cwd: string; info: import("../workspace/workspace.js").WorkspaceInfo; cleanup(): void };
  try {
    workspace = repoDir
      ? fsSync("createRepoWorkspace", () => createRepoWorkspace(repoDir, sessionId))
      : fsSync("createTempWorkspace", () => createTempWorkspace(sessionId));
  } catch (err) {
    cleanupGnupgHome(gnupgHome);
    await abort();
    throw err;
  }

  const providerName = normalizeRuntime(agentDetails.runtime);
  const provider = getProvider(providerName);

  const agentSkills = agentDetails.skills ?? [];
  if (!ensureSkills(workspace.cwd, agentSkills)) {
    logger.error(`Skill install failed for task ${task.id}, releasing task`);
    workspace.cleanup();
    cleanupGnupgHome(gnupgHome);
    await abort();
    return false;
  }

  const apiUrl = getCredentials().apiUrl;
  const agentClient = new AgentClient(apiUrl, agentId, sessionId, privateKey);
  const agentEnv = buildAgentEnv({
    agentId,
    sessionId,
    privateKeyJwk: privKeyJwk,
    agentName: agentDetails.name,
    agentUsername: (agentDetails as any).username ?? agentId,
    gpgSubkeyId,
    gnupgHome,
  });
  const systemPromptFile = writePromptFile(sessionId, generateSystemPrompt(agentDetails, boardType));

  const repos = await client.listRepositories();
  const taskRepo = repos.find((r: any) => r.id === task.repository_id);

  const taskContext = [
    `Task ID: ${task.id}`,
    `Title: ${task.title}`,
    task.description ? `Description: ${task.description}` : null,
    task.priority ? `Priority: ${task.priority}` : null,
    task.repository_id ? `Repository: ${taskRepo?.url ?? task.repository_id}` : null,
    `Board: ${task.board_id}`,
  ]
    .filter(Boolean)
    .join("\n");

  const sessions = getSessionManager();
  const sessionFile: SessionFile = {
    type: "worker",
    agentId,
    sessionId,
    runtime: providerName,
    startedAt: Date.now(),
    apiUrl: getCredentials().apiUrl,
    privateKeyJwk: privKeyJwk,
    taskId: task.id,
    workspace: workspace.info,
    status: "active",
    model: agentDetails.model ?? undefined,
    gpgSubkeyId,
    agentUsername: (agentDetails as any).username ?? agentId,
    agentName: agentDetails.name,
  };
  await sessions.create(sessionFile);

  await pool.spawnAgent({
    provider,
    taskId: task.id,
    sessionId,
    cwd: workspace.cwd,
    taskContext,
    agentClient,
    agentEnv,
    systemPromptFile,
    onCleanup: () => {
      workspace.cleanup();
      cleanupGnupgHome(gnupgHome);
    },
    model: agentDetails.model ?? undefined,
  });

  return true;
}
