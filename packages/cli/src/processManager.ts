import { spawn, type ChildProcess } from "child_process";
import type { ApiClient } from "./client.js";

// Agent Process Lifecycle:
//   SPAWN → pipe stdin (task context) → RUNNING
//     stdout → buffer lines → POST /messages (role='agent')
//     poll chat → pipe human messages to stdin
//   EXIT(0) → POST /complete → cleanup
//   EXIT(N) → POST /release → log stderr → cleanup
//   KILL (shutdown) → POST /release → cleanup

export interface AgentProcess {
  taskId: string;
  sessionId: string;
  process: ChildProcess;
  chatPollTimer: ReturnType<typeof setInterval> | null;
  lastChatSeen: string;
}

export class ProcessManager {
  private agents = new Map<string, AgentProcess>();
  private client: ApiClient;
  private agentCli: string;
  private onSlotFreed: () => void;

  constructor(client: ApiClient, agentCli: string, onSlotFreed: () => void) {
    this.client = client;
    this.agentCli = agentCli;
    this.onSlotFreed = onSlotFreed;
  }

  get activeCount(): number {
    return this.agents.size;
  }

  async spawnAgent(
    taskId: string,
    sessionId: string,
    cwd: string,
    taskContext: string,
  ): Promise<void> {
    const args = this.buildArgs(sessionId);

    let proc: ChildProcess;
    try {
      proc = spawn(this.agentCli, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env },
      });
    } catch (err: any) {
      console.error(`[ERROR] Failed to spawn ${this.agentCli}: ${err.message}`);
      await this.releaseTask(taskId);
      return;
    }

    if (!proc.pid) {
      console.error(`[ERROR] ${this.agentCli} not found or failed to start`);
      await this.releaseTask(taskId);
      return;
    }

    const agent: AgentProcess = {
      taskId,
      sessionId,
      process: proc,
      chatPollTimer: null,
      lastChatSeen: new Date().toISOString(),
    };
    this.agents.set(taskId, agent);

    // Pipe task context to stdin
    proc.stdin?.write(taskContext + "\n");

    // Capture stdout → POST as agent messages
    let stdoutBuffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (line.trim()) {
          this.postMessage(taskId, sessionId, "agent", line).catch(() => {});
        }
      }
    });

    // Capture stderr for crash diagnostics
    let stderrBuffer = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 10000) stderrBuffer = stderrBuffer.slice(-5000);
    });

    // Start chat polling (human → agent stdin)
    agent.chatPollTimer = setInterval(() => this.pollChat(agent), 3000);

    // Handle exit
    proc.on("exit", async (code) => {
      // Flush remaining stdout buffer
      if (stdoutBuffer.trim()) {
        this.postMessage(taskId, sessionId, "agent", stdoutBuffer).catch(() => {});
      }
      this.cleanup(taskId);

      if (code === 0) {
        console.log(`[INFO] Agent completed task ${taskId}`);
        await this.client.completeTask(taskId, { agent_id: sessionId }).catch((err: any) => {
          console.error(`[WARN] Failed to complete task ${taskId}: ${err.message}`);
        });
      } else {
        console.warn(`[WARN] Agent crashed on task ${taskId} (exit ${code})`);
        if (stderrBuffer.trim()) {
          const lastLines = stderrBuffer.trim().split("\n").slice(-5).join("\n");
          console.warn(`  stderr: ${lastLines}`);
        }
        await this.releaseTask(taskId);
      }

      this.onSlotFreed();
    });

    proc.on("error", async (err) => {
      console.error(`[ERROR] Agent process error for task ${taskId}: ${err.message}`);
      this.cleanup(taskId);
      await this.releaseTask(taskId);
      this.onSlotFreed();
    });

    console.log(`[INFO] Spawned ${this.agentCli} (session=${sessionId}) for task ${taskId} in ${cwd}`);
  }

  async killAll(): Promise<void> {
    const entries = [...this.agents.entries()];
    for (const [taskId, agent] of entries) {
      console.log(`[INFO] Killing agent for task ${taskId}`);
      agent.process.kill("SIGTERM");
      this.cleanup(taskId);
      await this.releaseTask(taskId);
    }
  }

  private buildArgs(sessionId: string): string[] {
    // Claude Code: claude --session-id <id> -p "prompt"
    // For now, just pass session ID. Task context goes via stdin.
    if (this.agentCli === "claude") {
      return ["--session-id", sessionId];
    }
    return [];
  }

  private async pollChat(agent: AgentProcess): Promise<void> {
    try {
      const messages = await this.client.getMessages(agent.taskId, agent.lastChatSeen);
      for (const msg of messages) {
        if (msg.role === "human") {
          agent.process.stdin?.write(msg.content + "\n");
        }
        agent.lastChatSeen = msg.created_at;
      }
    } catch {
      // Silently skip — next poll will retry
    }
  }

  private async postMessage(taskId: string, sessionId: string, role: string, content: string): Promise<void> {
    await this.client.sendMessage(taskId, { agent_id: sessionId, role, content });
  }

  private async releaseTask(taskId: string): Promise<void> {
    await this.client.releaseTask(taskId).catch((err: any) => {
      console.error(`[WARN] Failed to release task ${taskId}: ${err.message}`);
    });
  }

  private cleanup(taskId: string): void {
    const agent = this.agents.get(taskId);
    if (agent?.chatPollTimer) clearInterval(agent.chatPollTimer);
    this.agents.delete(taskId);
  }
}
