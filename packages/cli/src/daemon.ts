import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { homedir, hostname, platform, arch, release } from "os";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { ApiClient } from "./client.js";
import { ProcessManager } from "./processManager.js";
import { getLinks, findPathForRepository } from "./links.js";
import { getConfigValue, setConfigValue } from "./config.js";

// Daemon Lifecycle:
//   STARTING → check PID lock → load config → load links
//     → POLLING → GET /api/tasks → filter → assign
//       → SPAWNING → processManager.spawn()
//     → POLLING (loop)
//   SIGINT → SHUTTING_DOWN → kill agents → release tasks → remove PID → exit

const PID_FILE = join(homedir(), ".agent-kanban", "daemon.pid");

export interface DaemonOptions {
  maxConcurrent: number;
  agentCli: string;
  pollInterval?: number;
}

export async function startDaemon(opts: DaemonOptions): Promise<void> {
  // PID lock
  if (existsSync(PID_FILE)) {
    const pid = parseInt(readFileSync(PID_FILE, "utf-8").trim(), 10);
    try {
      process.kill(pid, 0); // Check if process exists
      console.error(`Daemon already running (PID ${pid}). Stop it first or remove ${PID_FILE}`);
      process.exit(1);
    } catch {
      // Stale PID file — process is dead, clean up
      unlinkSync(PID_FILE);
    }
  }
  writeFileSync(PID_FILE, String(process.pid));

  const client = new ApiClient();
  const links = getLinks();
  const linkedRepoCount = Object.keys(links).length;

  if (linkedRepoCount === 0) {
    console.warn("[WARN] No linked repositories. Run `ak link` in your repo directories.");
  } else {
    console.log(`[INFO] Linked repositories: ${linkedRepoCount}`);
  }

  const pm = new ProcessManager(client, opts.agentCli, () => {
    // Slot freed — trigger immediate poll
    schedulePoll(0);
  });

  let running = true;
  let pollTimer: ReturnType<typeof setTimeout> | null = null;
  let backoffMs = opts.pollInterval || 10000;
  const baseInterval = opts.pollInterval || 10000;

  // Graceful shutdown
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
    const machine = await client.registerMachine(machineInfo.name);
    machineId = machine.id;
    setConfigValue("machine-id", machineId);
    console.log(`[INFO] Machine registered: ${machineId}`);
  }

  await client.heartbeat(machineId, machineInfo).catch((err: any) =>
    console.error(`[WARN] Initial heartbeat failed: ${err.message}`)
  );
  console.log(`[INFO] Machine online: ${machineInfo.name} (${machineInfo.os}, runtimes: ${machineInfo.runtimes.join(", ") || "none"})`);

  const heartbeatInterval = setInterval(() => {
    client.heartbeat(machineId!, machineInfo).catch((err: any) =>
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

      // Filter out blocked, already-assigned, already-spawned, and tasks without a linked repo
      const available = tasks.filter((t: any) => {
        if (t.blocked || t.assigned_to) return false;
        if (pm.hasTask(t.id)) return false;
        if (!t.repository_id) return false;
        if (!findPathForRepository(t.repository_id)) {
          console.warn(`[WARN] Skipping task ${t.id}: no linked directory for repository ${t.repository_id}`);
          return false;
        }
        return true;
      });

      if (available.length === 0) {
        backoffMs = baseInterval;
        schedulePoll(baseInterval);
        return;
      }

      // Pick the first available task
      const task = available[0];
      const repoDir = findPathForRepository(task.repository_id)!;
      const sessionId = randomUUID();

      // Assign locks the task to this agent (status stays todo)
      try {
        await client.assignTask(task.id, sessionId);
      } catch (err: any) {
        if (err.message.includes("409") || err.message.includes("assigned") || err.message.includes("blocked")) {
          schedulePoll(1000);
          return;
        }
        throw err;
      }

      console.log(`[INFO] Assigned task ${task.id}: ${task.title} → agent ${sessionId}`);

      // Ensure the agent-kanban skill is installed in the target repo
      ensureSkill(repoDir);

      // Notify the agent — it will claim, work, create PR, and submit for review
      const prompt = `You have a new task assigned to you. Task ID: ${task.id}\nFollow the agent-kanban skill workflow: claim the task, do the work, create a PR with gh, then submit for review with ak task review --pr-url <url>. Do NOT call task complete — only humans can complete tasks.`;
      await pm.spawnAgent(task.id, sessionId, repoDir, prompt);

      // Reset backoff on success
      backoffMs = baseInterval;
      schedulePoll(1000); // Quick re-poll for more tasks

    } catch (err: any) {
      console.error(`[WARN] Poll error: ${err.message}`);
      backoffMs = Math.min(backoffMs * 2, 60000);
      schedulePoll(backoffMs);
    }
  }

  // Start first poll
  schedulePoll(0);
}


const SKILL_SOURCE = "bonaysoft/agent-kanban";
const SKILL_NAME = "agent-kanban";

function ensureSkill(repoDir: string) {
  const skillFile = join(repoDir, `.claude/skills/${SKILL_NAME}/SKILL.md`);

  try {
    if (!existsSync(skillFile)) {
      console.log(`[INFO] Installing skill "${SKILL_NAME}" in ${repoDir}`);
      execSync(`npx skills add ${SKILL_SOURCE} --skill ${SKILL_NAME} --agent claude-code --agent universal -y`, {
        cwd: repoDir,
        stdio: "pipe",
      });
    } else {
      // Check for updates
      const result = execSync("npx skills update", { cwd: repoDir, stdio: "pipe" }).toString();
      if (result.includes("up to date")) return;
      console.log(`[INFO] Skill "${SKILL_NAME}" updated in ${repoDir}`);
    }

    // Commit any changes
    execSync(`git add .claude/skills/ && git diff --cached --quiet || git commit -m "chore: update ${SKILL_NAME} skill"`, {
      cwd: repoDir,
      stdio: "pipe",
    });
  } catch (err: any) {
    console.error(`[WARN] Failed to ensure skill: ${err.message}`);
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
