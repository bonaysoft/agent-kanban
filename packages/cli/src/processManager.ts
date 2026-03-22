import { spawn, type ChildProcess } from "child_process";
import type { ApiClient, AgentClient } from "./client.js";

// Agent Process Lifecycle:
//   SPAWN → stdin task notification → RUNNING
//     agent claims task via CLI, works, completes via CLI
//     stdout (stream-json) → parse events → POST /messages
//   EXIT(0) → log success → cleanup
//   EXIT(N) → POST /release (crash recovery) → cleanup
//   KILL (shutdown) → POST /release → cleanup

export interface AgentProcess {
  taskId: string;
  sessionId: string;
  process: ChildProcess;
  agentClient: AgentClient;
  timeoutTimer?: ReturnType<typeof setTimeout>;
}

export class ProcessManager {
  private agents = new Map<string, AgentProcess>();
  private client: ApiClient;
  private agentCli: string;
  private onSlotFreed: () => void;
  private taskTimeoutMs: number;

  constructor(client: ApiClient, agentCli: string, onSlotFreed: () => void, taskTimeoutMs = 2 * 60 * 60 * 1000) {
    this.client = client;
    this.agentCli = agentCli;
    this.onSlotFreed = onSlotFreed;
    this.taskTimeoutMs = taskTimeoutMs;
  }

  get activeCount(): number {
    return this.agents.size;
  }

  hasTask(taskId: string): boolean {
    return this.agents.has(taskId);
  }

  async spawnAgent(
    taskId: string,
    sessionId: string,
    cwd: string,
    taskContext: string,
    agentClient: AgentClient,
    agentEnv: Record<string, string>,
  ): Promise<void> {
    const args = [
      "--print",
      "--verbose",
      "--input-format", "stream-json",
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
      "--session-id", sessionId,
      "-w",
    ];

    let proc: ChildProcess;
    try {
      proc = spawn(this.agentCli, args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, ...agentEnv },
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

    const agent: AgentProcess = { taskId, sessionId, process: proc, agentClient };
    this.agents.set(taskId, agent);

    if (this.taskTimeoutMs > 0) {
      agent.timeoutTimer = setTimeout(() => {
        console.warn(`[WARN] Agent for task ${taskId} exceeded timeout (${Math.round(this.taskTimeoutMs / 60000)}m), killing`);
        proc.kill("SIGTERM");
      }, this.taskTimeoutMs);
    }

    proc.on("spawn", () => {
      const payload = JSON.stringify({
        type: "user",
        message: { role: "user", content: taskContext },
      });
      proc.stdin?.write(payload + "\n");
      proc.stdin?.end();
    });

    let stdoutBuffer = "";
    proc.stdout?.on("data", (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      const lines = stdoutBuffer.split("\n");
      stdoutBuffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          this.handleEvent(taskId, sessionId, event, agentClient);
        } catch { /* non-JSON line, skip */ }
      }
    });

    let stderrBuffer = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrBuffer += chunk.toString();
      if (stderrBuffer.length > 10000) stderrBuffer = stderrBuffer.slice(-5000);
    });

    proc.on("close", async (code) => {
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);

      if (stdoutBuffer.trim()) {
        try {
          const event = JSON.parse(stdoutBuffer);
          this.handleEvent(taskId, sessionId, event, agentClient);
        } catch { /* skip */ }
      }

      this.agents.delete(taskId);

      if (code === 0) {
        console.log(`[INFO] Agent finished task ${taskId}`);
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
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
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
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      agent.process.kill("SIGTERM");
      this.agents.delete(taskId);
      await this.releaseTask(taskId);
    }
  }

  private handleEvent(taskId: string, sessionId: string, event: any, agentClient: AgentClient): void {
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          agentClient.sendMessage(taskId, { agent_id: sessionId, role: "agent", content: block.text })
            .catch((err: any) => console.error(`[ERROR] Failed to send message for task ${taskId}: ${err.message}`));
        }
      }
    }
    if (event.type === "result") {
      const cost = event.total_cost_usd || 0;
      const usage = event.usage || {};
      console.log(`[INFO] Agent result for task ${taskId}: cost=$${cost.toFixed(4)}`);
      agentClient.updateAgentUsage(sessionId, {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_micro_usd: Math.round(cost * 1_000_000),
      }).catch((err: any) => console.error(`[ERROR] Failed to report usage for task ${taskId}: ${err.message}`));
    }
  }

  private async releaseTask(taskId: string, retries = 3): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.client.releaseTask(taskId);
        return;
      } catch (err: any) {
        console.error(`[WARN] Failed to release task ${taskId} (attempt ${i + 1}/${retries}): ${err.message}`);
        if (i < retries - 1) await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
      }
    }
    console.error(`[ERROR] Could not release task ${taskId} after ${retries} attempts. Task will remain locked until stale detection.`);
  }
}
