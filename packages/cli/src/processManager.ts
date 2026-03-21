import { spawn, type ChildProcess } from "child_process";
import type { ApiClient } from "./client.js";

// Agent Process Lifecycle:
//   SPAWN → stdin JSON message → RUNNING
//     stdout (stream-json) → parse events → POST /messages
//   EXIT(0) → POST /complete → cleanup
//   EXIT(N) → POST /release → log stderr → cleanup
//   KILL (shutdown) → POST /release → cleanup

export interface AgentProcess {
  taskId: string;
  sessionId: string;
  process: ChildProcess;
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
    const args = [
      "--verbose",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--session-id", sessionId,
    ];

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

    const agent: AgentProcess = { taskId, sessionId, process: proc };
    this.agents.set(taskId, agent);

    // Send task context as JSON message via stdin, then close
    proc.on("spawn", () => {
      const payload = JSON.stringify({
        type: "user",
        message: { role: "user", content: taskContext },
      });
      proc.stdin?.write(payload + "\n");
      proc.stdin?.end();
    });

    // Parse stdout (stream-json): each line is a JSON event
    let stdoutBuffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this.handleEvent(taskId, sessionId, event);
        } catch { /* non-JSON line, skip */ }
      }
    });

    // Capture stderr for crash diagnostics
    let stderrBuffer = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 10000) stderrBuffer = stderrBuffer.slice(-5000);
    });

    // Handle exit
    proc.on("close", async (code) => {
      // Flush remaining stdout
      if (stdoutBuffer.trim()) {
        try {
          const event = JSON.parse(stdoutBuffer);
          this.handleEvent(taskId, sessionId, event);
        } catch { /* skip */ }
      }

      this.agents.delete(taskId);

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
      this.agents.delete(taskId);
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
      this.agents.delete(taskId);
      await this.releaseTask(taskId);
    }
  }

  private handleEvent(taskId: string, sessionId: string, event: any): void {
    // Extract text from assistant messages → post as agent chat messages
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          this.postMessage(taskId, sessionId, "agent", block.text).catch(() => {});
        }
      }
    }
    // Report usage on result event
    if (event.type === "result") {
      const cost = event.total_cost_usd || 0;
      const usage = event.usage || {};
      console.log(`[INFO] Agent result for task ${taskId}: cost=$${cost.toFixed(4)}`);
      this.client.updateAgentUsage(sessionId, {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_usd: cost,
      }).catch(() => {});
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
}
