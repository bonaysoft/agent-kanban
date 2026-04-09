import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BoardType } from "@agent-kanban/shared";
import { type AgentInfo, generateSystemPrompt, writePromptFile } from "../agent/systemPrompt.js";
import { AgentClient, ApiError, type MachineClient } from "../client/index.js";
import { getCredentials } from "../config.js";
import { createLogger } from "../logger.js";
import { getProvider, normalizeRuntime } from "../providers/registry.js";
import { removeSession, updateSession, writeSession } from "../session/store.js";
import type { SessionFile } from "../session/types.js";
import { ensureSkills } from "../workspace/skills.js";
import type { Workspace } from "../workspace/workspace.js";
import { createRepoWorkspace, createTempWorkspace, restoreWorkspace } from "../workspace/workspace.js";
import type { ProcessManager } from "./processManager.js";

const logger = createLogger("runner");

interface BuildEnvOpts {
  agentId: string;
  sessionId: string;
  privateKeyJwk: JsonWebKey;
  agentName: string;
  agentUsername: string;
  gpgSubkeyId: string | null;
  gnupgHome: string | null;
}

export class TaskRunner {
  constructor(
    private client: MachineClient,
    private pm: ProcessManager,
  ) {}

  /** Full pipeline: session → keys → workspace → skills → spawn. Returns true on success. */
  async dispatch(task: any, repoDir: string | null, boardType: BoardType): Promise<boolean> {
    const agentId = task.assigned_to;
    const sessionId = randomUUID();

    const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
    const pubKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
    const privKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);

    try {
      await this.client.createSession(agentId, sessionId, pubKeyJwk.x!);
    } catch (err: any) {
      if (err instanceof ApiError && (err.status === 409 || err.status === 404)) return false;
      throw err;
    }

    logger.info(`Session ${sessionId.slice(0, 8)} for agent ${agentId} on task ${task.id}: ${task.title}`);

    const abort = () => this.releaseAndClose(task.id, agentId, sessionId);

    const agentDetails = (await this.client.getAgent(agentId)) as AgentInfo | null;
    if (!agentDetails) {
      logger.error(`Agent ${agentId} not found, releasing task ${task.id}`);
      await abort();
      return false;
    }

    const gpgSubkeyId = (agentDetails as any).gpg_subkey_id ?? null;
    let gnupgHome: string | null = null;
    if (gpgSubkeyId) {
      try {
        const gpgData = await this.client.getAgentGpgKey(agentId);
        gnupgHome = setupGnupgHome(gpgData.armored_private_key);
      } catch (err: any) {
        logger.warn(`GPG setup failed for agent ${agentId}: ${err.message}`);
      }
    }

    // ---- Workspace ----
    let workspace: Workspace;
    try {
      workspace = repoDir ? createRepoWorkspace(repoDir, sessionId) : createTempWorkspace(sessionId);
    } catch (err: any) {
      logger.error(`Failed to create workspace: ${err.message}`);
      cleanupGnupgHome(gnupgHome);
      await abort();
      return false;
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

    try {
      const apiUrl = getCredentials().apiUrl;
      const agentClient = new AgentClient(apiUrl, agentId, sessionId, privateKey);
      const agentEnv = this.buildAgentEnv({
        agentId,
        sessionId,
        privateKeyJwk: privKeyJwk,
        agentName: agentDetails.name,
        agentUsername: (agentDetails as any).username ?? agentId,
        gpgSubkeyId,
        gnupgHome,
      });
      const systemPromptFile = writePromptFile(sessionId, generateSystemPrompt(agentDetails, boardType));

      const repos = await this.client.listRepositories();
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

      // Persist session before spawning — crash-safe
      const sessionFile: SessionFile = {
        type: "worker",
        agentId,
        sessionId,
        pid: 0, // updated by onProcessStarted callback
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
      writeSession(sessionFile);

      await this.pm.spawnAgent({
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
    } catch (err) {
      workspace.cleanup();
      cleanupGnupgHome(gnupgHome);
      await abort();
      throw err;
    }
  }

  /** Resume a saved session (rate-limited or rejected). */
  async resumeSession(session: SessionFile, message: string): Promise<boolean> {
    const workspace = restoreWorkspace(session.workspace!);
    const taskId = session.taskId!;

    // Worktree may have been wiped out from under us (e.g. by an earlier
    // safeCleanup bug, or manual cleanup). Resuming `claude --resume` in a
    // missing cwd crashes within ~200ms and the task gets re-dispatched as a
    // brand-new agent with no rejection context. Bail out cleanly instead.
    if (!existsSync(workspace.cwd)) {
      logger.warn(`Workspace ${workspace.cwd} missing for session ${session.sessionId}, releasing task ${taskId}`);
      removeSession(session.sessionId);
      await this.client.releaseTask(taskId).catch(() => {});
      return false;
    }

    let task: any;
    try {
      task = await this.client.getTask(taskId);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 404) {
        logger.warn(`Task ${taskId} not found (deleted), cleaning up session`);
        workspace.cleanup();
        removeSession(session.sessionId);
        return false;
      }
      throw err;
    }
    if (!task || task.status === "cancelled" || task.status === "done") {
      logger.info(`Task ${taskId} is ${task?.status ?? "missing"}, cleaning up resume session`);
      workspace.cleanup();
      removeSession(session.sessionId);
      return false;
    }

    let privateKey: CryptoKey;
    try {
      privateKey = (await crypto.subtle.importKey("jwk", session.privateKeyJwk, { name: "Ed25519" } as any, true, ["sign"])) as CryptoKey;
    } catch (err: any) {
      logger.error(`Failed to import key for session ${session.sessionId}: ${err.message}`);
      removeSession(session.sessionId);
      await this.client.releaseTask(taskId).catch(() => {});
      return false;
    }

    try {
      await this.client.reopenSession(session.agentId, session.sessionId);
    } catch (err: any) {
      // Transient failure (network, 429, etc.) — keep session file so we can retry
      // on the next tick. Only destroying the session on transient errors is what
      // caused the "rejected task never resumes" bug.
      logger.warn(`Failed to reopen session ${session.sessionId}: ${err.message}, will retry next tick`);
      return false;
    }

    let gnupgHome: string | null = null;
    if (session.gpgSubkeyId) {
      try {
        const gpgData = await this.client.getAgentGpgKey(session.agentId);
        gnupgHome = setupGnupgHome(gpgData.armored_private_key);
      } catch (err: any) {
        logger.warn(`GPG setup failed on resume: ${err.message}`);
      }
    }

    const provider = getProvider(normalizeRuntime(session.runtime));
    const apiUrl = getCredentials().apiUrl;
    const agentClient = new AgentClient(apiUrl, session.agentId, session.sessionId, privateKey);
    const agentEnv = this.buildAgentEnv({
      agentId: session.agentId,
      sessionId: session.sessionId,
      privateKeyJwk: session.privateKeyJwk,
      agentName: session.agentName ?? "Agent",
      agentUsername: session.agentUsername ?? session.agentId,
      gpgSubkeyId: session.gpgSubkeyId ?? null,
      gnupgHome,
    });

    logger.info(`Resuming task ${taskId} (session=${session.sessionId.slice(0, 8)})`);

    try {
      await this.pm.spawnAgent({
        provider,
        taskId: taskId,
        sessionId: session.sessionId,
        cwd: workspace.cwd,
        taskContext: message,
        agentClient,
        agentEnv,
        resume: true,
        onCleanup: () => {
          workspace.cleanup();
          cleanupGnupgHome(gnupgHome);
        },
        model: session.model,
      });
    } catch (err: any) {
      logger.warn(`Failed to resume task ${taskId}: ${err.message}, will retry next tick`);
      cleanupGnupgHome(gnupgHome);
      return false;
    }

    updateSession(session.sessionId, { status: "active" });
    return true;
  }

  private async releaseAndClose(taskId: string, agentId: string, sessionId: string): Promise<void> {
    await this.client.releaseTask(taskId).catch(() => {});
    await this.client.closeSession(agentId, sessionId).catch(() => {});
  }

  private buildAgentEnv(opts: BuildEnvOpts): Record<string, string> {
    const { agentId, sessionId, privateKeyJwk, agentName, agentUsername, gpgSubkeyId, gnupgHome } = opts;
    const email = `${agentUsername}@mails.agent-kanban.dev`;
    const displayName = agentName;
    const env: Record<string, string> = {
      AK_AGENT_ID: agentId,
      AK_SESSION_ID: sessionId,
      AK_AGENT_KEY: JSON.stringify(privateKeyJwk),
      AK_API_URL: getCredentials().apiUrl,
      GIT_AUTHOR_NAME: displayName,
      GIT_AUTHOR_EMAIL: email,
      GIT_COMMITTER_NAME: displayName,
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
}

function setupGnupgHome(armoredPrivateKey: string): string {
  const gnupgHome = mkdtempSync(join(tmpdir(), "ak-gpg-"));
  const keyFile = join(gnupgHome, "key.asc");
  writeFileSync(keyFile, armoredPrivateKey, { mode: 0o600 });
  try {
    execFileSync("gpg", ["--batch", "--import", keyFile], {
      env: { ...process.env, GNUPGHOME: gnupgHome },
      stdio: "pipe",
    });
  } finally {
    try {
      rmSync(keyFile);
    } catch {
      /* best-effort */
    }
  }
  return gnupgHome;
}

function cleanupGnupgHome(gnupgHome: string | null): void {
  if (!gnupgHome) return;
  try {
    rmSync(gnupgHome, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
