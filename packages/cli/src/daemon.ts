import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { hostname, platform, arch, release } from "os";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { MachineClient, AgentClient, ApiError } from "./client.js";
import { ProcessManager } from "./processManager.js";
import { PrMonitor } from "./prMonitor.js";
import { generateSystemPrompt, writePromptFile, type AgentInfo } from "./systemPrompt.js";
import { getLinks, findPathForRepository, setLink } from "./links.js";
import { getConfigValue, setConfigValue, PID_FILE } from "./config.js";
import { getUsage } from "./usage.js";
import { REPOS_DIR } from "./paths.js";

// Daemon Lifecycle:
//   STARTING → check PID lock → load config → load links
//     → POLLING → GET /api/tasks → filter → assign
//       → SPAWNING → processManager.spawn()
//     → POLLING (loop)
//   SIGINT → SHUTTING_DOWN → kill agents → release tasks → remove PID → exit

export interface DaemonOptions {
  maxConcurrent: number;
  agentCli: string;
  pollInterval?: number;
  taskTimeout?: number; // ms, default 2h
}

export async function startDaemon(opts: DaemonOptions): Promise<void> {
  // PID lock
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0);
      console.error(`Daemon already running (PID ${pid}). Stop it first or remove ${PID_FILE}`);
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
    console.error("[FATAL] `gh` is not installed or not authenticated. Run `gh auth login` first.");
    process.exit(1);
  }

  const client = new MachineClient();
  const links = getLinks();
  const linkedRepoCount = Object.keys(links).length;

  if (linkedRepoCount === 0) {
    console.warn("[WARN] No linked repositories. Run `ak link` in your repo directories.");
  } else {
    console.log(`[INFO] Linked repositories: ${linkedRepoCount}`);
  }

  const pm = new ProcessManager(client, opts.agentCli, () => {
    schedulePoll(baseInterval);
  }, opts.taskTimeout);

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
    console.log("\n[INFO] Shutting down daemon...");
    prMonitor.stop();
    clearInterval(heartbeatInterval);
    if (pollTimer) clearTimeout(pollTimer);
    await pm.killAll();
    removePidFile();
    console.log("[INFO] Daemon stopped.");
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  console.log(`[INFO] Daemon started (PID ${process.pid}, max_concurrent=${opts.maxConcurrent}, agent=${opts.agentCli})`);

  // Register machine (first run) or reuse existing
  const machineInfo = getMachineInfo();
  let machineId = getConfigValue("machine-id");

  if (!machineId) {
    const machine = await client.registerMachine(machineInfo);
    machineId = machine.id;
    setConfigValue("machine-id", machineId);
    console.log(`[INFO] Machine registered: ${machineId}`);
  }

  await client.heartbeat(machineId, { version: machineInfo.version, runtimes: machineInfo.runtimes });
  console.log(`[INFO] Machine online: ${machineInfo.name} (${machineInfo.os}, runtimes: ${machineInfo.runtimes.join(", ") || "none"})`);

  const heartbeatInterval = setInterval(async () => {
    const usageInfo = await getUsage();
    client.heartbeat(machineId!, { version: machineInfo.version, runtimes: machineInfo.runtimes, usage_info: usageInfo }).catch((err: any) =>
      console.error(`[WARN] Heartbeat failed: ${err.message}`)
    );
  }, 30000);

  function schedulePoll(delayMs: number) {
    if (!running) return;
    if (pollTimer) clearTimeout(pollTimer);
    pollTimer = setTimeout(poll, delayMs);
  }

  async function poll() {
    if (!running) return;

    try {
      // Check for cancelled tasks and kill their agents
      const activeTaskIds = pm.getActiveTaskIds();
      for (const taskId of activeTaskIds) {
        const task = await client.getTask(taskId) as any;
        if (task?.status === "cancelled") {
          await pm.killTask(taskId);
        }
      }

      if (pm.activeCount >= opts.maxConcurrent) {
        schedulePoll(baseInterval);
        return;
      }

      const tasks = await client.listTasks({ status: "todo" }) as any[];

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
        if (t.blocked || !t.assigned_to) return false;  // must be assigned to an agent
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

      const { publicKey, privateKey } = await crypto.subtle.generateKey(
        { name: "Ed25519" } as any, true, ["sign", "verify"]
      );
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

      console.log(`[INFO] Session ${sessionId.slice(0, 8)} for agent ${agentId} on task ${task.id}: ${task.title}`);

      if (!ensureSkill(repoDir)) {
        console.error(`[ERROR] Skill install failed for task ${task.id}, releasing task`);
        await client.releaseTask(task.id).catch((err: any) =>
          console.error(`[ERROR] Failed to release task ${task.id} after skill failure: ${err.message}`)
        );
        await client.closeSession(agentId, sessionId).catch(() => {});
        schedulePoll(baseInterval);
        return;
      }

      const agentClient = new AgentClient(
        getConfigValue("api-url")!,
        agentId,
        sessionId,
        privateKey,
      );

      const agentEnv = {
        AK_AGENT_ID: agentId,
        AK_SESSION_ID: sessionId,
        AK_AGENT_KEY: JSON.stringify(privKeyJwk),
        AK_API_URL: getConfigValue("api-url")!,
      };

      // Fetch agent details and generate system prompt
      const agentDetails = await client.getAgent(agentId) as AgentInfo | null;
      if (!agentDetails) {
        console.error(`[ERROR] Agent ${agentId} not found, releasing task ${task.id}`);
        await client.releaseTask(task.id).catch(() => {});
        await client.closeSession(agentId, sessionId).catch(() => {});
        schedulePoll(baseInterval);
        return;
      }
      const systemPromptFile = writePromptFile(sessionId, generateSystemPrompt(agentDetails));

      const repos = await client.listRepositories();
      const taskRepo = repos.find((r: any) => r.id === task.repository_id);

      const taskContext = [
        `Task ID: ${task.id}`,
        `Title: ${task.title}`,
        task.description ? `Description: ${task.description}` : null,
        task.priority ? `Priority: ${task.priority}` : null,
        `Repository: ${taskRepo?.full_name ?? task.repository_id}`,
        `Board: ${task.board_id}`,
      ].filter(Boolean).join("\n");

      await pm.spawnAgent(task.id, sessionId, repoDir, taskContext, agentClient, agentEnv, systemPromptFile);
      prMonitor.track(task.id);

      backoffMs = baseInterval;
      schedulePoll(baseInterval);

    } catch (err: any) {
      if (err instanceof ApiError && err.status === 429) {
        console.warn(`[WARN] Rate limited, backing off`);
        backoffMs = Math.min(Math.max(backoffMs * 2, 30000), 60000);
      } else {
        console.error(`[WARN] Poll error: ${err.message}`);
        backoffMs = Math.min(backoffMs * 2, 60000);
      }
      schedulePoll(backoffMs);
    }
  }

  schedulePoll(0);
}


const SKILL_SOURCE = "bonaysoft/agent-kanban";
const SKILL_NAME = "agent-kanban";

function ensureSkill(repoDir: string): boolean {
  const skillFile = join(repoDir, `.claude/skills/${SKILL_NAME}/SKILL.md`);

  try {
    if (!existsSync(skillFile)) {
      console.log(`[INFO] Installing skill "${SKILL_NAME}" in ${repoDir}`);
      execSync(`npx skills add ${SKILL_SOURCE} --skill ${SKILL_NAME} --agent claude-code --agent universal -y`, {
        cwd: repoDir,
        stdio: "pipe",
      });
    } else {
      const result = execSync("npx skills update", { cwd: repoDir, stdio: "pipe" }).toString();
      if (result.includes("up to date")) return true;
      console.log(`[INFO] Skill "${SKILL_NAME}" updated in ${repoDir}`);
    }

    execSync(`git add .claude/skills/ && git diff --cached --quiet || git commit -m "chore: update ${SKILL_NAME} skill"`, {
      cwd: repoDir,
      stdio: "pipe",
    });
    return true;
  } catch (err: any) {
    console.error(`[ERROR] Failed to ensure skill: ${err.message}`);
    return false;
  }
}

const LEFTHOOK_LABEL = "setup:lefthook";
const LEFTHOOK_CONFIG_FILES = [
  "lefthook.yml", "lefthook.yaml", "lefthook.json", "lefthook.toml",
  ".lefthook.yml", ".lefthook.yaml", ".lefthook.json", ".lefthook.toml",
];

function hasLefthookConfig(repoDir: string): boolean {
  return LEFTHOOK_CONFIG_FILES.some((f) => existsSync(join(repoDir, f)));
}

/** Returns true if a lefthook setup task was created (caller should skip this poll cycle). */
async function ensureLefthookTask(client: MachineClient, task: any, repoDir: string, allTasks: any[]): Promise<boolean> {
  if (hasLefthookConfig(repoDir)) return false;
  if (task.labels?.includes(LEFTHOOK_LABEL)) return false;

  console.log(`[INFO] No lefthook config in ${repoDir}, creating setup task`);

  const agents = await client.listAgents() as any[];
  const qualityAgent = agents.find((a: any) => a.builtin && a.role === "quality-goalkeeper");
  if (!qualityAgent) {
    console.log("[WARN] No builtin quality-goalkeeper agent found, skipping lefthook setup");
    return false;
  }

  const setupTask = await client.createTask({
    title: "Setup lefthook quality gates for this repository",
    description: "This repository has no lefthook configuration. Analyze the project's tech stack, set up appropriate quality checks, and enforce them via lefthook pre-commit hooks.",
    board_id: task.board_id,
    repository_id: task.repository_id,
    labels: [LEFTHOOK_LABEL],
    assigned_to: qualityAgent.id,
  }) as any;

  console.log(`[INFO] Created lefthook setup task ${setupTask.id}`);

  // Block all todo tasks in this repo on the setup task
  const repoTasks = allTasks.filter((t: any) => t.repository_id === task.repository_id);
  for (const t of repoTasks) {
    await client.updateTask(t.id, {
      depends_on: [...(t.depends_on || []), setupTask.id],
    });
  }

  console.log(`[INFO] Blocked ${repoTasks.length} tasks on lefthook setup task ${setupTask.id}`);
  return true;
}

function cloneAndLink(repo: any): void {
  try {
    const repoPath = repo.url.replace(/^https?:\/\//, "");
    const repoDir = join(REPOS_DIR, repoPath);
    if (existsSync(repoDir)) {
      console.log(`[INFO] Directory exists, linking repository ${repo.name} → ${repoDir}`);
      setLink(repo.id, repoDir);
      return;
    }

    console.log(`[INFO] Cloning ${repo.full_name} → ${repoDir}`);
    execSync(`gh repo clone ${repo.full_name} ${repoDir}`, { stdio: "pipe" });
    setLink(repo.id, repoDir);
    console.log(`[INFO] Linked repository ${repo.name} → ${repoDir}`);
  } catch (err: any) {
    console.error(`[ERROR] Auto-clone failed for repository ${repo.id}: ${err.message}`);
  }
}

function removePidFile() {
  try { unlinkSync(PID_FILE); } catch { /* ignore */ }
}

function detectRuntimes(): string[] {
  const commands: [string, string][] = [
    ["claude", "Claude Code"],
    ["codex", "Codex"],
    ["gemini", "Gemini CLI"],
  ];
  const found: string[] = [];
  for (const [cmd, label] of commands) {
    try {
      execSync(`which ${cmd}`, { stdio: "ignore" });
      found.push(label);
    } catch { /* not installed */ }
  }
  return found;
}

function getMachineInfo() {
  const os = `${platform()} ${arch()} ${release()}`;
  const runtimes = detectRuntimes();
  let version = "unknown";
  try {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, "../package.json"), "utf-8"));
    version = pkg.version;
  } catch { /* ignore */ }
  return { name: hostname(), os, version, runtimes };
}
