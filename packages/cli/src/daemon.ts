import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { hostname, platform, arch, release } from "os";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { MachineClient, AgentClient } from "./client.js";
import { ProcessManager } from "./processManager.js";
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
    schedulePoll(0);
  }, opts.taskTimeout);

  let running = true;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = opts.pollInterval || 10000;
  const baseInterval = opts.pollInterval || 10000;

  const shutdown = async () => {
    if (!running) return;
    running = false;
    console.log("\n[INFO] Shutting down daemon...");
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
      if (pm.activeCount >= opts.maxConcurrent) {
        schedulePoll(baseInterval);
        return;
      }

      const tasks = await client.listTasks({ status: "todo" }) as any[];

      // Auto-clone repos that have no local link
      const repoCache = new Map<string, string | null>();
      for (const t of tasks) {
        if (t.blocked || t.assigned_to || pm.hasTask(t.id) || !t.repository_id) continue;
        if (findPathForRepository(t.repository_id) || repoCache.has(t.repository_id)) continue;
        const cloned = await autoCloneRepo(client, t.repository_id);
        repoCache.set(t.repository_id, cloned);
      }

      const available = tasks.filter((t: any) => {
        if (t.blocked || t.assigned_to) return false;
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
      const sessionId = randomUUID();

      const { publicKey, privateKey } = await crypto.subtle.generateKey(
        { name: "Ed25519" } as any, true, ["sign", "verify"]
      );
      const pubKeyJwk = await crypto.subtle.exportKey("jwk", publicKey);
      const privKeyJwk = await crypto.subtle.exportKey("jwk", privateKey);
      const pubKeyBase64 = pubKeyJwk.x;

      try {
        await client.registerAgent(sessionId, pubKeyBase64, opts.agentCli);
        await client.assignTask(task.id, sessionId);
      } catch (err: any) {
        if (err.message.includes("409") || err.message.includes("assigned") || err.message.includes("blocked")) {
          schedulePoll(1000);
          return;
        }
        throw err;
      }

      console.log(`[INFO] Assigned task ${task.id}: ${task.title} → agent ${sessionId}`);

      if (!ensureSkill(repoDir)) {
        console.error(`[ERROR] Skill install failed for task ${task.id}, releasing task`);
        await client.releaseTask(task.id).catch((err: any) =>
          console.error(`[ERROR] Failed to release task ${task.id} after skill failure: ${err.message}`)
        );
        schedulePoll(baseInterval);
        return;
      }

      const agentClient = new AgentClient(
        getConfigValue("api-url")!,
        sessionId,
        privateKey,
      );

      const agentEnv = {
        AK_AGENT_ID: sessionId,
        AK_AGENT_KEY: JSON.stringify(privKeyJwk),
        AK_API_URL: getConfigValue("api-url")!,
      };

      const prompt = `You have a new task assigned to you. Task ID: ${task.id}\nFollow the agent-kanban skill workflow: claim the task, do the work, create a PR with gh, then submit for review with ak task review --pr-url <url>. Do NOT call task complete — only humans can complete tasks.`;
      await pm.spawnAgent(task.id, sessionId, repoDir, prompt, agentClient, agentEnv);

      backoffMs = baseInterval;
      schedulePoll(1000);

    } catch (err: any) {
      console.error(`[WARN] Poll error: ${err.message}`);
      backoffMs = Math.min(backoffMs * 2, 60000);
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

async function autoCloneRepo(client: MachineClient, repositoryId: string): Promise<string | null> {
  try {
    const repos = await client.listRepositories();
    const repo = repos.find((r: any) => r.id === repositoryId);
    if (!repo?.full_name) return null;

    const repoDir = join(REPOS_DIR, repo.name);
    if (existsSync(repoDir)) {
      console.log(`[INFO] Directory exists, linking repository ${repo.name} → ${repoDir}`);
      setLink(repositoryId, repoDir);
      return repoDir;
    }

    console.log(`[INFO] Cloning ${repo.full_name} → ${repoDir}`);
    execSync(`gh repo clone ${repo.full_name} ${repoDir}`, { stdio: "pipe" });
    setLink(repositoryId, repoDir);
    console.log(`[INFO] Linked repository ${repo.name} → ${repoDir}`);
    return repoDir;
  } catch (err: any) {
    console.error(`[ERROR] Auto-clone failed for repository ${repositoryId}: ${err.message}`);
    return null;
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
