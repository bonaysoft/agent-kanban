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
  agentClient?: AgentClient;
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

  hasTask(taskId: string): boolean {
    return this.agents.has(taskId);
  }

  async spawnAgent(
    taskId: string,
    sessionId: string,
    cwd: string,
    taskContext: string,
    agentClient?: AgentClient,
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

    const agent: AgentProcess = { taskId, sessionId, process: proc, agentClient };
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
          this.handleEvent(taskId, sessionId, event, agentClient);
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

  private handleEvent(taskId: string, sessionId: string, event: any, agentClient?: AgentClient): void {
    // Extract text from assistant messages → post as agent chat messages
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          this.postMessage(taskId, sessionId, "agent", block.text, agentClient).catch(() => {});
        }
      }
    }
    // Report usage on result event
    if (event.type === "result") {
      const cost = event.total_cost_usd || 0;
      const usage = event.usage || {};
      console.log(`[INFO] Agent result for task ${taskId}: cost=$${cost.toFixed(4)}`);
      const usageData = {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_micro_usd: Math.round(cost * 1_000_000),
      };
      if (agentClient) {
        agentClient.updateAgentUsage(usageData).catch(() => {});
      } else {
        this.client.updateAgentUsage(sessionId, usageData).catch(() => {});
      }
    }
  }

  private async postMessage(taskId: string, sessionId: string, role: string, content: string, agentClient?: AgentClient): Promise<void> {
    const body = { agent_id: sessionId, role, content };
    if (agentClient) {
      await agentClient.sendMessage(taskId, body);
    } else {
      await this.client.sendMessage(taskId, body);
    }
  }

  private async releaseTask(taskId: string): Promise<void> {
    await this.client.releaseTask(taskId).catch((err: any) => {
      console.error(`[WARN] Failed to release task ${taskId}: ${err.message}`);
    });
  }
}
