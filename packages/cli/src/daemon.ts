import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { arch, hostname, platform, release } from "node:os";
import { join } from "node:path";
import { AgentClient, ApiError, MachineClient } from "./client.js";
import { getConfigValue, PID_FILE, setConfigValue } from "./config.js";
import { findPathForRepository, getLinks, setLink } from "./links.js";
import { createLogger } from "./logger.js";
import { REPOS_DIR, SESSION_PIDS_FILE, WORKTREES_DIR } from "./paths.js";
import { PrMonitor } from "./prMonitor.js";
import { ProcessManager } from "./processManager.js";
import { getAvailableProviders, getProvider } from "./providers/registry.js";

import { loadReviewSessions, removeReviewSession } from "./reviewSessions.js";
import { type AgentInfo, generateSystemPrompt, writePromptFile } from "./systemPrompt.js";

const logger = createLogger("daemon");

// Daemon Lifecycle:
//   STARTING → check PID lock → load config → load links
//     → POLLING → GET /api/tasks → filter → assign
//       → SPAWNING → processManager.spawn()
//     → POLLING (loop)
//   SIGINT → SHUTTING_DOWN → kill agents → release tasks → remove PID → exit

export interface DaemonOptions {
  maxConcurrent: number;
  defaultProvider?: string;
  pollInterval?: number;
  taskTimeout?: number; // ms, default 2h
}

function normalizeRuntime(runtime: string): string {
  if (runtime === "claude-code") return "claude";
  return runtime;
}

export async function startDaemon(opts: DaemonOptions): Promise<void> {
  // PID lock
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0);
      logger.error(`Daemon already running (PID ${pid}). Stop it first or remove ${PID_FILE}`);
      process.exit(1);
    } catch {
      unlinkSync(PID_FILE);
    }
  }
  writeFileSync(PID_FILE, String(process.pid));

  // Preflight: gh must be installed and authenticated
  try {
    execSync("gh auth status", { stdio: "pipe" });
  } catch {
    removePidFile();
    logger.fatal("`gh` is not installed or not authenticated. Run `gh auth login` first.");
    process.exit(1);
  }

  const client = new MachineClient();
  const links = getLinks();
  const linkedRepoCount = Object.keys(links).length;

  if (linkedRepoCount === 0) {
    logger.warn("No linked repositories. Run `ak link` in your repo directories.");
  } else {
    logger.info(`Linked repositories: ${linkedRepoCount}`);
  }

  let paused = false;
  let resumeTimer: ReturnType<typeof setTimeout> | null = null;
  let resumeTargetMs = 0;

  const pm = new ProcessManager(
    client,
    {
      onSlotFreed: () => schedulePoll(baseInterval),
      onRateLimited: pauseForRateLimit,
      onProcessStarted: saveSessionPid,
      onProcessExited: removeSessionPid,
    },
    opts.taskTimeout,
  );

  const prMonitor = new PrMonitor(client);
  prMonitor.start();

  let running = true;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  const MIN_POLL_INTERVAL = 5000;
  const baseInterval = Math.max(opts.pollInterval || 10000, MIN_POLL_INTERVAL);
  let backoffMs = baseInterval;

  const shutdown = async () => {
    if (!running) return;
    running = false;
    logger.info("Shutting down daemon...");
    prMonitor.stop();
    clearInterval(heartbeatInterval);
    if (pollTimer) clearTimeout(pollTimer);
    if (resumeTimer) clearTimeout(resumeTimer);
    await pm.killAll();
    clearSessionPids();
    removePidFile();
    logger.info("Daemon stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  logger.info(`Daemon started (PID ${process.pid}, max_concurrent=${opts.maxConcurrent}, default_provider=${opts.defaultProvider ?? "auto"})`);

  // Register machine (first run) or reuse existing
  const machineInfo = getMachineInfo();
  let machineId = getConfigValue("machine-id");

  if (!machineId) {
    const machine = await client.registerMachine(machineInfo);
    machineId = machine.id;
    setConfigValue("machine-id", machineId);
    logger.info(`Machine registered: ${machineId}`);
  }

  await client.heartbeat(machineId, {
    version: machineInfo.version,
    runtimes: machineInfo.runtimes,
  });
  await cleanupStaleSessions(client, machineId);
  logger.info(`Machine online: ${machineInfo.name} (${machineInfo.os}, runtimes: ${machineInfo.runtimes.join(", ") || "none"})`);

  const defaultProvider = opts.defaultProvider ? getProvider(normalizeRuntime(opts.defaultProvider)) : null;

  const heartbeatInterval = setInterval(async () => {
    const usageInfo = defaultProvider?.getUsage ? await defaultProvider.getUsage() : null;
    client
      .heartbeat(machineId!, {
        version: machineInfo.version,
        runtimes: machineInfo.runtimes,
        usage_info: usageInfo,
      })
      .catch((err: any) => logger.warn(`Heartbeat failed: ${err.message}`));
  }, 30000);

  function pauseForRateLimit(resetAt: string) {
    const resetTime = new Date(resetAt).getTime();
    const currentResetTime = resumeTimer ? (resumeTargetMs ?? 0) : 0;
    if (paused && resetTime <= currentResetTime) return;
    paused = true;
    resumeTargetMs = resetTime;
    const waitMs = Math.max(resetTime - Date.now(), 60_000);
    logger.warn(`Usage exhausted — pausing dispatch until ${resetAt} (${Math.round(waitMs / 60_000)}min)`);
    if (resumeTimer) clearTimeout(resumeTimer);
    resumeTimer = setTimeout(resume, waitMs);
  }

  async function resume() {
    if (!running || !paused) return;
    logger.info("Rate limit window reset, resuming");
    paused = false;
    resumeTargetMs = 0;
    await resumeSuspended();
    schedulePoll(0);
  }

  async function resumeSuspended() {
    const sessions = pm.getSuspended();
    pm.clearSuspended();
    for (const s of sessions) {
      const task = (await client.getTask(s.taskId)) as any;
      if (!task || task.status === "cancelled" || task.status === "done") continue;

      try {
        await client.reopenSession(s.agentId, s.sessionId);
      } catch {
        logger.warn(`Failed to reopen session ${s.sessionId}, releasing task ${s.taskId}`);
        await client.releaseTask(s.taskId).catch(() => {});
        continue;
      }

      const agentClient = new AgentClient(getConfigValue("api-url")!, s.agentId, s.sessionId, s.privateKey);

      const agentEnv = {
        AK_AGENT_ID: s.agentId,
        AK_SESSION_ID: s.sessionId,
        AK_AGENT_KEY: JSON.stringify(s.privateKeyJwk),
        AK_API_URL: getConfigValue("api-url")!,
      };

      logger.info(`Resuming task ${s.taskId} (session=${s.sessionId.slice(0, 8)})`);
      try {
        const resumeCleanup = () => removeWorktree(s.repoDir, s.cwd, s.branchName);
        await pm.spawnAgent(
          s.provider,
          s.taskId,
          s.sessionId,
          s.cwd,
          s.repoDir,
          s.branchName,
          "",
          agentClient,
          agentEnv,
          s.privateKey,
          s.privateKeyJwk,
          undefined,
          true,
          resumeCleanup,
          s.model,
        );
      } catch {
        logger.warn(`Failed to resume task ${s.taskId}, releasing`);
        await client.releaseTask(s.taskId).catch(() => {});
      }
    }
  }

  async function checkReviewSessions() {
    const apiUrl = getConfigValue("api-url")!;
    const reviewSessions = loadReviewSessions();
    for (const rs of reviewSessions) {
      const task = (await client.getTask(rs.taskId)) as any;
      if (!task) {
        removeReviewSession(rs.taskId);
        continue;
      }

      if (task.status === "done" || task.status === "cancelled") {
        removeWorktree(rs.repoDir, rs.cwd, rs.branchName);
        removeReviewSession(rs.taskId);
        continue;
      }

      if (task.status === "in_progress" && !pm.hasTask(rs.taskId)) {
        logger.info(`Task ${rs.taskId} was rejected, resuming agent in existing worktree`);

        const privateKey = (await crypto.subtle.importKey("jwk", rs.privateKeyJwk, { name: "Ed25519" } as any, true, ["sign"])) as CryptoKey;

        try {
          await client.reopenSession(rs.agentId, rs.sessionId);
        } catch {
          logger.warn(`Failed to reopen session ${rs.sessionId}, releasing task ${rs.taskId}`);
          removeWorktree(rs.repoDir, rs.cwd, rs.branchName);
          removeReviewSession(rs.taskId);
          await client.releaseTask(rs.taskId).catch(() => {});
          continue;
        }

        const agentClient = new AgentClient(apiUrl, rs.agentId, rs.sessionId, privateKey);

        const agentEnv = {
          AK_AGENT_ID: rs.agentId,
          AK_SESSION_ID: rs.sessionId,
          AK_AGENT_KEY: JSON.stringify(rs.privateKeyJwk),
          AK_API_URL: apiUrl,
        };

        const agentDetails = (await client.getAgent(rs.agentId)) as AgentInfo | null;
        const providerName = normalizeRuntime(agentDetails?.runtime ?? opts.defaultProvider ?? "claude");
        const reviewProvider = getProvider(providerName);

        const logs = (await client.getTaskLogs(rs.taskId)) as any[];
        const rejectLog = [...logs].reverse().find((l: any) => l.action === "rejected");
        const rejectReason = rejectLog?.detail || "No reason provided";

        try {
          const rejectMessage = `Task rejected. Reason: ${rejectReason}\n\nPlease fix the issues and submit for review again.`;
          await pm.spawnAgent(
            reviewProvider,
            rs.taskId,
            rs.sessionId,
            rs.cwd,
            rs.repoDir,
            rs.branchName,
            rejectMessage,
            agentClient,
            agentEnv,
            privateKey,
            rs.privateKeyJwk,
            undefined,
            true,
            () => removeWorktree(rs.repoDir, rs.cwd, rs.branchName),
            agentDetails?.model ?? undefined,
          );
        } catch {
          logger.warn(`Failed to resume rejected task ${rs.taskId}, releasing`);
          removeWorktree(rs.repoDir, rs.cwd, rs.branchName);
          await client.releaseTask(rs.taskId).catch(() => {});
        }

        removeReviewSession(rs.taskId);
      }
    }
  }

  function schedulePoll(delayMs: number) {
    if (!running) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, delayMs);
  }

  async function poll() {
    if (!running || paused) return;

    try {
      // Check for cancelled tasks and kill their agents
      const activeTaskIds = pm.getActiveTaskIds();
      for (const taskId of activeTaskIds) {
        const task = (await client.getTask(taskId)) as any;
        if (task?.status === "cancelled") {
          await pm.killTask(taskId);
        }
      }

      // Check review sessions for rejected/completed tasks
      await checkReviewSessions();

      if (pm.activeCount >= opts.maxConcurrent) {
        schedulePoll(baseInterval);
        return;
      }

      const tasks = (await client.listTasks({ status: "todo" })) as any[];

      // Auto-clone repos that have no local link
      const unlinkedRepoIds = new Set<string>();
      for (const t of tasks) {
        if (t.blocked || !t.assigned_to || pm.hasTask(t.id) || !t.repository_id) continue;
        if (!findPathForRepository(t.repository_id)) unlinkedRepoIds.add(t.repository_id);
      }
      if (unlinkedRepoIds.size > 0) {
        const repos = await client.listRepositories();
        for (const repoId of unlinkedRepoIds) {
          const repo = repos.find((r: any) => r.id === repoId);
          if (repo?.full_name) await cloneAndLink(repo);
        }
      }

      const available = tasks.filter((t: any) => {
        if (t.blocked || !t.assigned_to) return false; // must be assigned to an agent
        if (pm.hasTask(t.id)) return false;
        if (!t.repository_id) return false;
        if (!findPathForRepository(t.repository_id)) return false;
        return true;
      });

      if (available.length === 0) {
        backoffMs = baseInterval;
        schedulePoll(baseInterval);
        return;
      }

      const task = available[0];
      const repoDir = findPathForRepository(task.repository_id)!;

      if (!prepareRepo(repoDir)) {
        logger.error(`Repo not ready at ${repoDir}, skipping task ${task.id}`);
        schedulePoll(baseInterval);
        return;
      }

      // Ensure lefthook quality gates before first real task
      if (await ensureLefthookTask(client, task, repoDir, tasks)) {
        schedulePoll(baseInterval);
        return;
      }
      // Task must already be assigned to an agent (persistent ID)
      const agentId = task.assigned_to;
      if (!agentId) {
        schedulePoll(baseInterval);
        return;
      }

      const sessionId = randomUUID();

      const { publicKey, privateKey } = await crypto.subtle.generateKey({ name: "Ed25519" } as any, true, ["sign", "verify"]);
      const pubKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
      const privKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);
      const pubKeyBase64 = pubKeyJwk.x!;

      try {
        await client.createSession(agentId, sessionId, pubKeyBase64);
      } catch (err: any) {
        if (err.message.includes("409") || err.message.includes("not found")) {
          schedulePoll(1000);
          return;
        }
        throw err;
      }

      logger.info(`Session ${sessionId.slice(0, 8)} for agent ${agentId} on task ${task.id}: ${task.title}`);

      // Fetch agent details early — needed for both skill install and system prompt
      const agentDetails = (await client.getAgent(agentId)) as AgentInfo | null;
      if (!agentDetails) {
        logger.error(`Agent ${agentId} not found, releasing task ${task.id}`);
        await client.releaseTask(task.id).catch(() => {});
        await client.closeSession(agentId, sessionId).catch(() => {});
        schedulePoll(baseInterval);
        return;
      }

      let worktreeDir: string;
      let branchName: string;
      try {
        ({ worktreeDir, branchName } = createWorktree(repoDir, sessionId));
      } catch (err: any) {
        logger.error(`Failed to create worktree in ${repoDir}: ${err.message}`);
        await client.releaseTask(task.id).catch(() => {});
        await client.closeSession(agentId, sessionId).catch(() => {});
        schedulePoll(baseInterval);
        return;
      }

      // Resolve provider from agent runtime
      const providerName = normalizeRuntime(agentDetails.runtime ?? opts.defaultProvider ?? "claude");
      const taskProvider = getProvider(providerName);

      const agentSkills = agentDetails.skills ?? [];
      if (!ensureSkills(worktreeDir, agentSkills)) {
        logger.error(`Skill install failed for task ${task.id}, releasing task`);
        removeWorktree(repoDir, worktreeDir, branchName);
        await client.releaseTask(task.id).catch((err: any) => logger.error(`Failed to release task ${task.id} after skill failure: ${err.message}`));
        await client.closeSession(agentId, sessionId).catch(() => {});
        schedulePoll(baseInterval);
        return;
      }

      const agentClient = new AgentClient(getConfigValue("api-url")!, agentId, sessionId, privateKey);

      const agentEnv = {
        AK_AGENT_ID: agentId,
        AK_SESSION_ID: sessionId,
        AK_AGENT_KEY: JSON.stringify(privKeyJwk),
        AK_API_URL: getConfigValue("api-url")!,
      };
      const systemPromptFile = writePromptFile(sessionId, generateSystemPrompt(agentDetails));

      const repos = await client.listRepositories();
      const taskRepo = repos.find((r: any) => r.id === task.repository_id);

      const taskContext = [
        `Task ID: ${task.id}`,
        `Title: ${task.title}`,
        task.description ? `Description: ${task.description}` : null,
        task.priority ? `Priority: ${task.priority}` : null,
        `Repository: ${taskRepo?.url ?? task.repository_id}`,
        `Board: ${task.board_id}`,
      ]
        .filter(Boolean)
        .join("\n");

      const cleanup = () => removeWorktree(repoDir, worktreeDir, branchName);
      await pm.spawnAgent(
        taskProvider,
        task.id,
        sessionId,
        worktreeDir,
        repoDir,
        branchName,
        taskContext,
        agentClient,
        agentEnv,
        privateKey,
        privKeyJwk,
        systemPromptFile,
        false,
        cleanup,
        agentDetails.model ?? undefined,
      );
      prMonitor.track(task.id);

      backoffMs = baseInterval;
      schedulePoll(baseInterval);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 429) {
        logger.warn("Rate limited, backing off");
        backoffMs = Math.min(Math.max(backoffMs * 2, 30000), 60000);
      } else {
        logger.warn(`Poll error: ${err.message}`);
        backoffMs = Math.min(backoffMs * 2, 60000);
      }
      schedulePoll(backoffMs);
    }
  }

  schedulePoll(0);
}

const SKILL_SOURCE = "saltbo/agent-kanban";
const SKILL_NAME = "agent-kanban";

function installSkill(repoDir: string, source: string, skill: string): boolean {
  const skillFile = join(repoDir, `.claude/skills/${skill}/SKILL.md`);
  if (!existsSync(skillFile)) {
    logger.info(`Installing skill "${skill}" from ${source} in ${repoDir}`);
    try {
      execSync(`npx skills add ${source} --skill ${skill} --agent claude-code --agent universal -y`, {
        cwd: repoDir,
        stdio: "pipe",
      });
    } catch (err: any) {
      const stderr = err.stderr?.toString() || err.message;
      logger.warn(`Failed to install skill "${skill}" from ${source}: ${stderr}`);
      return false;
    }
    return true;
  }
  return false;
}

const SKILL_GITIGNORE_ENTRIES = [".claude/skills/", ".agents/", "skills-lock.json"];

function ensureSkills(worktreeDir: string, agentSkills: string[]): boolean {
  try {
    let changed = installSkill(worktreeDir, SKILL_SOURCE, SKILL_NAME);

    for (const entry of agentSkills) {
      // format: "source@skill-name"
      const atIdx = entry.indexOf("@");
      if (atIdx === -1) {
        logger.warn(`Skipping invalid skill entry (missing @): ${entry}`);
        continue;
      }
      const source = entry.slice(0, atIdx);
      const skill = entry.slice(atIdx + 1);
      const installed = installSkill(worktreeDir, source, skill);
      if (installed) changed = true;
    }

    if (!changed) {
      const result = execSync("npx skills update", { cwd: worktreeDir, stdio: "pipe" }).toString();
      if (result.includes("up to date")) return true;
      logger.info(`Skills updated in ${worktreeDir}`);
    }

    // Ensure skill paths are gitignored so agents don't commit them
    const gitignorePath = join(worktreeDir, ".gitignore");
    const existing = existsSync(gitignorePath) ? readFileSync(gitignorePath, "utf-8") : "";
    const missing = SKILL_GITIGNORE_ENTRIES.filter((e) => !existing.includes(e));
    if (missing.length > 0) {
      appendFileSync(gitignorePath, `\n# agent skills (managed by daemon)\n${missing.join("\n")}\n`);
    }

    return true;
  } catch (err: any) {
    logger.error(`Failed to ensure skills: ${err.message}`);
    return false;
  }
}

const LEFTHOOK_LABEL = "setup:lefthook";
const LEFTHOOK_CONFIG_FILES = [
  "lefthook.yml",
  "lefthook.yaml",
  "lefthook.json",
  "lefthook.toml",
  ".lefthook.yml",
  ".lefthook.yaml",
  ".lefthook.json",
  ".lefthook.toml",
];

function hasLefthookConfig(repoDir: string): boolean {
  return LEFTHOOK_CONFIG_FILES.some((f) => existsSync(join(repoDir, f)));
}

/** Returns true if a lefthook setup task was created (caller should skip this poll cycle). */
async function ensureLefthookTask(client: MachineClient, task: any, repoDir: string, allTasks: any[]): Promise<boolean> {
  if (hasLefthookConfig(repoDir)) return false;

  // Check if any lefthook task already exists for this repo
  const existingLefthook = allTasks.find((t) => t.repository_id === task.repository_id && t.labels?.includes(LEFTHOOK_LABEL));
  if (existingLefthook) return !existingLefthook.blocked;

  logger.info(`No lefthook config in ${repoDir}, creating setup task`);

  const agents = (await client.listAgents()) as any[];
  const qualityAgent = agents.find((a: any) => a.builtin && a.role === "quality-goalkeeper");
  if (!qualityAgent) {
    logger.warn("No builtin quality-goalkeeper agent found, skipping lefthook setup");
    return false;
  }

  const setupTask = (await client.createTask({
    title: "Setup lefthook quality gates for this repository",
    description:
      "This repository has no lefthook configuration. Analyze the project's tech stack, set up appropriate quality checks, and enforce them via lefthook pre-commit hooks.",
    board_id: task.board_id,
    repository_id: task.repository_id,
    labels: [LEFTHOOK_LABEL],
    assigned_to: qualityAgent.id,
  })) as any;

  logger.info(`Created lefthook setup task ${setupTask.id}`);

  // Block all todo tasks in this repo on the setup task
  const repoTasks = allTasks.filter((t: any) => t.repository_id === task.repository_id);
  for (const t of repoTasks) {
    await client.updateTask(t.id, {
      depends_on: [...(t.depends_on || []), setupTask.id],
    });
  }

  logger.info(`Blocked ${repoTasks.length} tasks on lefthook setup task ${setupTask.id}`);
  return true;
}

function cloneAndLink(repo: any): void {
  try {
    const repoPath = repo.url.replace(/^https?:\/\//, "");
    const repoDir = join(REPOS_DIR, repoPath);
    if (existsSync(repoDir)) {
      logger.info(`Directory exists, linking repository ${repo.name} → ${repoDir}`);
      setLink(repo.id, repoDir);
      return;
    }

    logger.info(`Cloning ${repo.full_name} → ${repoDir}`);
    execSync(`gh repo clone ${repo.full_name} ${repoDir}`, { stdio: "pipe" });
    setLink(repo.id, repoDir);
    logger.info(`Linked repository ${repo.name} → ${repoDir}`);
  } catch (err: any) {
    logger.error(`Auto-clone failed for repository ${repo.id}: ${err.message}`);
  }
}

function prepareRepo(repoDir: string): boolean {
  try {
    const status = execSync("git status --porcelain", { cwd: repoDir, stdio: "pipe" }).toString().trim();
    if (status) {
      logger.info(`Stashing dirty working tree in ${repoDir}`);
      execSync("git stash --include-untracked", { cwd: repoDir, stdio: "pipe" });
    }

    logger.info(`Pulling latest code in ${repoDir}`);
    execSync("git pull --ff-only", { cwd: repoDir, stdio: "pipe" });
    return true;
  } catch (err: any) {
    logger.error(`Failed to prepare repo ${repoDir}: ${err.message}`);
    return false;
  }
}

function createWorktree(repoDir: string, sessionId: string): { worktreeDir: string; branchName: string } {
  const branchName = `ak/${sessionId.slice(0, 8)}`;
  mkdirSync(WORKTREES_DIR, { recursive: true });
  const worktreeDir = join(WORKTREES_DIR, sessionId.slice(0, 8));
  execSync(`git worktree add "${worktreeDir}" -b "${branchName}"`, { cwd: repoDir, stdio: "pipe" });
  logger.info(`Created worktree ${worktreeDir} (branch ${branchName})`);
  return { worktreeDir, branchName };
}

function removeWorktree(repoDir: string, worktreeDir: string, branchName: string): void {
  try {
    execSync(`git worktree remove "${worktreeDir}" --force`, { cwd: repoDir, stdio: "pipe" });
    execSync(`git branch -D "${branchName}"`, { cwd: repoDir, stdio: "pipe" });
    logger.info(`Removed worktree ${worktreeDir}`);
  } catch (err: any) {
    logger.warn(`Failed to remove worktree ${worktreeDir}: ${err.message}`);
  }
}

function removePidFile() {
  try {
    unlinkSync(PID_FILE);
  } catch {
    /* ignore */
  }
}

function loadSessionPids(): Map<string, number> {
  try {
    const data = JSON.parse(readFileSync(SESSION_PIDS_FILE, "utf-8"));
    return new Map(Object.entries(data));
  } catch {
    return new Map();
  }
}

function writeSessionPids(pids: Map<string, number>): void {
  writeFileSync(SESSION_PIDS_FILE, JSON.stringify(Object.fromEntries(pids)));
}

function saveSessionPid(sessionId: string, pid: number): void {
  const pids = loadSessionPids();
  pids.set(sessionId, pid);
  writeSessionPids(pids);
}

function removeSessionPid(sessionId: string): void {
  const pids = loadSessionPids();
  if (pids.delete(sessionId)) writeSessionPids(pids);
}

function clearSessionPids(): void {
  try {
    unlinkSync(SESSION_PIDS_FILE);
  } catch {
    /* ignore */
  }
}

function isProcessAlive(sessionId: string): boolean {
  const pid = loadSessionPids().get(sessionId);
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function cleanupStaleSessions(client: MachineClient, machineId: string): Promise<void> {
  try {
    const agents = (await client.listAgents()) as any[];
    const closedSessionIds: string[] = [];
    for (const agent of agents) {
      const sessions = (await client.listSessions(agent.id)) as any[];
      for (const session of sessions) {
        if (session.status !== "active" || session.machine_id !== machineId) continue;
        if (!isProcessAlive(session.id)) {
          await client.closeSession(agent.id, session.id).catch(() => {});
          closedSessionIds.push(session.id);
        }
      }
    }
    if (closedSessionIds.length > 0) {
      const pids = loadSessionPids();
      for (const id of closedSessionIds) pids.delete(id);
      writeSessionPids(pids);
      logger.info(`Cleaned up ${closedSessionIds.length} stale session(s) from previous run`);
    }
  } catch (err: any) {
    logger.warn(`Session cleanup failed: ${err.message}`);
  }
}

function getMachineInfo() {
  const os = `${platform()} ${arch()} ${release()}`;
  const runtimes = getAvailableProviders().map((p) => p.label);
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"));
    version = pkg.version;
  } catch {
    /* ignore */
  }
  return { name: hostname(), os, version, runtimes };
}
