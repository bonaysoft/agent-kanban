import { randomUUID } from "node:crypto";
import type { BoardType } from "@agent-kanban/shared";
import { AgentClient, ApiError, type MachineClient } from "./client.js";
import { getCredentials } from "./config.js";
import { createLogger } from "./logger.js";
import type { ProcessManager } from "./processManager.js";
import { getProvider, normalizeRuntime } from "./providers/registry.js";
import { removeSession, type SavedSession, saveSession, updateSessionStatus } from "./savedSessions.js";
import { ensureSkills } from "./skillManager.js";
import { type AgentInfo, generateSystemPrompt, writePromptFile } from "./systemPrompt.js";
import { createRepoWorkspace, createTempWorkspace, restoreWorkspace, type Workspace } from "./workspace.js";

const logger = createLogger("runner");

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

    // ---- Workspace ----
    let workspace: Workspace;
    try {
      workspace = repoDir ? createRepoWorkspace(repoDir, sessionId) : createTempWorkspace(sessionId);
    } catch (err: any) {
      logger.error(`Failed to create workspace: ${err.message}`);
      await abort();
      return false;
    }

    const providerName = normalizeRuntime(agentDetails.runtime);
    const provider = getProvider(providerName);

    const agentSkills = agentDetails.skills ?? [];
    if (!ensureSkills(workspace.cwd, agentSkills)) {
      logger.error(`Skill install failed for task ${task.id}, releasing task`);
      workspace.cleanup();
      await abort();
      return false;
    }

    const apiUrl = getCredentials().apiUrl;
    const agentClient = new AgentClient(apiUrl, agentId, sessionId, privateKey);
    const agentEnv = this.buildAgentEnv(agentId, sessionId, privKeyJwk);
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
    saveSession({
      taskId: task.id,
      sessionId,
      workspace: workspace.info,
      agentId,
      privateKeyJwk: privKeyJwk,
      runtime: providerName,
      model: agentDetails.model ?? undefined,
      status: "active",
    });

    await this.pm.spawnAgent({
      provider,
      taskId: task.id,
      sessionId,
      cwd: workspace.cwd,
      taskContext,
      agentClient,
      agentEnv,
      systemPromptFile,
      onCleanup: () => workspace.cleanup(),
      model: agentDetails.model ?? undefined,
    });

    return true;
  }

  /** Resume a saved session (rate-limited or rejected). */
  async resumeSession(session: SavedSession, message: string): Promise<boolean> {
    const workspace = restoreWorkspace(session.workspace);

    let task: any;
    try {
      task = await this.client.getTask(session.taskId);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 404) {
        logger.warn(`Task ${session.taskId} not found (deleted), cleaning up session`);
        workspace.cleanup();
        removeSession(session.taskId);
        return false;
      }
      throw err;
    }
    if (!task || task.status === "cancelled" || task.status === "done") {
      workspace.cleanup();
      removeSession(session.taskId);
      return false;
    }

    let privateKey: CryptoKey;
    try {
      privateKey = (await crypto.subtle.importKey("jwk", session.privateKeyJwk, { name: "Ed25519" } as any, true, ["sign"])) as CryptoKey;
    } catch (err: any) {
      logger.error(`Failed to import key for session ${session.sessionId}: ${err.message}`);
      removeSession(session.taskId);
      await this.client.releaseTask(session.taskId).catch(() => {});
      return false;
    }

    try {
      await this.client.reopenSession(session.agentId, session.sessionId);
    } catch {
      logger.warn(`Failed to reopen session ${session.sessionId}, releasing task ${session.taskId}`);
      workspace.cleanup();
      removeSession(session.taskId);
      await this.client.releaseTask(session.taskId).catch(() => {});
      return false;
    }

    const provider = getProvider(normalizeRuntime(session.runtime));
    const apiUrl = getCredentials().apiUrl;
    const agentClient = new AgentClient(apiUrl, session.agentId, session.sessionId, privateKey);
    const agentEnv = this.buildAgentEnv(session.agentId, session.sessionId, session.privateKeyJwk);

    logger.info(`Resuming task ${session.taskId} (session=${session.sessionId.slice(0, 8)})`);

    try {
      await this.pm.spawnAgent({
        provider,
        taskId: session.taskId,
        sessionId: session.sessionId,
        cwd: workspace.cwd,
        taskContext: message,
        agentClient,
        agentEnv,
        resume: true,
        onCleanup: () => workspace.cleanup(),
        model: session.model,
      });
    } catch {
      logger.warn(`Failed to resume task ${session.taskId}, releasing`);
      workspace.cleanup();
      removeSession(session.taskId);
      await this.client.releaseTask(session.taskId).catch(() => {});
      return false;
    }

    updateSessionStatus(session.taskId, "active");
    return true;
  }

  private async releaseAndClose(taskId: string, agentId: string, sessionId: string): Promise<void> {
    await this.client.releaseTask(taskId).catch(() => {});
    await this.client.closeSession(agentId, sessionId).catch(() => {});
  }

  private buildAgentEnv(agentId: string, sessionId: string, privateKeyJwk: JsonWebKey): Record<string, string> {
    return {
      AK_AGENT_ID: agentId,
      AK_SESSION_ID: sessionId,
      AK_AGENT_KEY: JSON.stringify(privateKeyJwk),
      AK_API_URL: getCredentials().apiUrl,
    };
  }
}
