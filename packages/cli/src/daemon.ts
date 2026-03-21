import { existsSync, writeFileSync, unlinkSync, readFileSync } from "fs";
import { join } from "path";
import { homedir, hostname, platform, arch, release } from "os";
import { execSync } from "child_process";
import { randomUUID } from "crypto";
import { ApiClient } from "./client.js";
import { ProcessManager } from "./processManager.js";
import { getLinkedProjectIds, findRepoForProject } from "./links.js";

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
  const linkedProjects = getLinkedProjectIds();

  if (linkedProjects.length === 0) {
    console.warn("[WARN] No linked projects. Run `ak link --project <name>` in your repo directories.");
    console.warn("[WARN] Daemon will poll all projects.");
  } else {
    console.log(`[INFO] Linked projects: ${linkedProjects.length}`);
  }

  // Resolve linked project IDs → board IDs at startup
  // boardProjectMap: boardId → projectId
  const boardProjectMap = new Map<string, string>();
  for (const projectId of linkedProjects) {
    try {
      const board = await client.getProjectBoard(projectId) as any;
      if (board?.id) {
        boardProjectMap.set(board.id, projectId);
      }
    } catch (err: any) {
      console.warn(`[WARN] Could not resolve board for project ${projectId}: ${err.message}`);
    }
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

  // Register machine and start heartbeat
  const machineInfo = getMachineInfo();
  await client.heartbeat(machineInfo).catch((err: any) =>
    console.error(`[WARN] Initial heartbeat failed: ${err.message}`)
  );
  console.log(`[INFO] Machine registered: ${machineInfo.name} (${machineInfo.os}, runtimes: ${machineInfo.runtimes.join(", ") || "none"})`);

  const heartbeatInterval = setInterval(() => {
    client.heartbeat(machineInfo).catch((err: any) =>
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

      const tasks = await client.listTasks({ status: "Todo" }) as any[];

      // Filter by linked boards (if any links exist)
      const candidates = boardProjectMap.size > 0
        ? tasks.filter((t: any) => boardProjectMap.has(t.board_id))
        : tasks;

      // Filter out blocked and already-assigned tasks
      const available = candidates.filter((t: any) => !t.blocked && !t.assigned_to);

      if (available.length === 0) {
        backoffMs = baseInterval;
        schedulePoll(baseInterval);
        return;
      }

      // Assign the first available task to a new agent
      const task = available[0];
      const sessionId = randomUUID();

      try {
        await client.assignTask(task.id, sessionId);
      } catch (err: any) {
        // Already assigned or blocked — skip
        if (err.message.includes("409") || err.message.includes("assigned") || err.message.includes("blocked")) {
          schedulePoll(1000);
          return;
        }
        throw err;
      }

      console.log(`[INFO] Assigned task ${task.id}: ${task.title} → agent ${sessionId}`);

      // Resolve repo directory via board → project → local link
      const projectId = boardProjectMap.get(task.board_id);
      const repoDir = projectId ? findRepoForProject(projectId) : undefined;
      if (!repoDir) {
        console.error(`[ERROR] No linked repo for board ${task.board_id}. Releasing task.`);
        await client.releaseTask(task.id).catch(() => {});
        schedulePoll(baseInterval);
        return;
      }

      // Build task context for agent stdin
      const context = buildTaskContext(task);
      await pm.spawnAgent(task.id, sessionId, repoDir, context);

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

function buildTaskContext(task: any): string {
  const parts = [`Task: ${task.title}`];
  if (task.description) parts.push(`Description: ${task.description}`);
  if (task.input) {
    try {
      const input = typeof task.input === "string" ? JSON.parse(task.input) : task.input;
      parts.push(`Input: ${JSON.stringify(input, null, 2)}`);
    } catch {
      parts.push(`Input: ${task.input}`);
    }
  }
  return parts.join("\n\n");
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
