import { spawn, type ChildProcess } from "child_process";
import type { ApiClient, AgentClient } from "./client.js";
import { cleanupPromptFile } from "./systemPrompt.js";

// Agent Process Lifecycle:
//   SPAWN → stdin task notification → RUNNING
//     agent claims task via CLI, works, completes via CLI
//     stdout (stream-json) → parse events → POST /messages
//   EXIT(0) → log success → cleanup
//   EXIT(N) → POST /release (crash recovery) → cleanup
//   KILL (shutdown) → POST /release → cleanup

export interface SuspendedSession {
  taskId: string;
  sessionId: string;
  cwd: string;
  agentId: string;
  privateKey: CryptoKey;
  privateKeyJwk: JsonWebKey;
}

export interface AgentProcess {
  taskId: string;
  sessionId: string;
  cwd: string;
  process: ChildProcess;
  agentClient: AgentClient;
  privateKey: CryptoKey;
  privateKeyJwk: JsonWebKey;
  timeoutTimer?: ReturnType<typeof setTimeout>;
  rateLimited?: boolean;
}

const RATE_LIMIT_CODES = new Set(["rate_limit_error", "overloaded_error"]);

export class ProcessManager {
  private agents = new Map<string, AgentProcess>();
  private suspended: SuspendedSession[] = [];
  private client: ApiClient;
  private agentCli: string;
  private onSlotFreed: () => void;
  private onRateLimited: (resetAt: string) => void;
  private taskTimeoutMs: number;

  constructor(client: ApiClient, agentCli: string, onSlotFreed: () => void, onRateLimited: (resetAt: string) => void, taskTimeoutMs = 2 * 60 * 60 * 1000) {
    this.client = client;
    this.agentCli = agentCli;
    this.onSlotFreed = onSlotFreed;
    this.onRateLimited = onRateLimited;
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
    privateKey: CryptoKey,
    privateKeyJwk: JsonWebKey,
    systemPromptFile?: string,
    resume?: boolean,
  ): Promise<void> {
    const args = resume
      ? ["--resume", "--verbose", "--output-format", "stream-json", "--dangerously-skip-permissions", "--session-id", sessionId, "-w"]
      : ["--print", "--verbose", "--input-format", "stream-json", "--output-format", "stream-json", "--dangerously-skip-permissions", "--session-id", sessionId, "-w"];
    if (!resume && systemPromptFile) {
      args.push("--system-prompt-file", systemPromptFile);
    }

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

    const agent: AgentProcess = { taskId, sessionId, cwd, process: proc, agentClient, privateKey, privateKeyJwk };
    this.agents.set(taskId, agent);

    if (this.taskTimeoutMs > 0) {
      agent.timeoutTimer = setTimeout(() => {
        console.warn(`[WARN] Agent for task ${taskId} exceeded timeout (${Math.round(this.taskTimeoutMs / 60000)}m), killing`);
        proc.kill("SIGTERM");
      }, this.taskTimeoutMs);
    }

    if (resume) {
      proc.on("spawn", () => proc.stdin?.end());
    } else {
      proc.on("spawn", () => {
        const payload = JSON.stringify({
          type: "user",
          message: { role: "user", content: taskContext },
        });
        proc.stdin?.write(payload + "\n");
        proc.stdin?.end();
      });
    }

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
      cleanupPromptFile(sessionId);

      // Already removed by killTask() — process was intentionally terminated
      if (!this.agents.has(taskId)) return;

      if (stdoutBuffer.trim()) {
        try {
          const event = JSON.parse(stdoutBuffer);
          this.handleEvent(taskId, sessionId, event, agentClient);
        } catch { /* skip */ }
      }

      this.agents.delete(taskId);

      await this.closeSession(agentClient);

      if (code === 0) {
        console.log(`[INFO] Agent finished task ${taskId}`);
      } else if (agent.rateLimited) {
        console.warn(`[WARN] Agent for task ${taskId} exited due to rate limit, suspending`);
        this.suspended.push({ taskId, sessionId, cwd: agent.cwd, agentId: agentClient.getAgentId(), privateKey: agent.privateKey, privateKeyJwk: agent.privateKeyJwk });
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
      if (!this.agents.has(taskId)) return;
      console.error(`[ERROR] Agent process error for task ${taskId}: ${err.message}`);
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      this.agents.delete(taskId);
      await this.closeSession(agentClient);
      await this.releaseTask(taskId);
      this.onSlotFreed();
    });

    console.log(`[INFO] Spawned ${this.agentCli} (session=${sessionId}) for task ${taskId} in ${cwd}`);
  }

  async killTask(taskId: string): Promise<void> {
    const agent = this.agents.get(taskId);
    if (!agent) return;
    console.log(`[INFO] Killing agent for cancelled task ${taskId}`);
    if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
    agent.process.kill("SIGTERM");
    this.agents.delete(taskId);
    await this.client.closeSession(agent.agentClient.getAgentId(), agent.sessionId).catch((err: any) =>
      console.error(`[WARN] Failed to close session for cancelled task ${taskId}: ${err.message}`)
    );
    this.onSlotFreed();
  }

  getActiveTaskIds(): string[] {
    return [...this.agents.keys()];
  }

  getSuspended(): SuspendedSession[] {
    return this.suspended;
  }

  clearSuspended(): void {
    this.suspended = [];
  }

  async killAll(): Promise<void> {
    const entries = [...this.agents.entries()];
    for (const [taskId, agent] of entries) {
      console.log(`[INFO] Killing agent for task ${taskId}`);
      if (agent.timeoutTimer) clearTimeout(agent.timeoutTimer);
      agent.process.kill("SIGTERM");
      this.agents.delete(taskId);
      await this.closeSession(agent.agentClient);
      await this.releaseTask(taskId);
    }
  }

  /** Detect error events — CLI has multiple shapes:
   *  1. { type: "error", error: { type: "rate_limit_error", message: "..." } }
   *  2. { type: "assistant", error: "unknown", message: { content: [{ type: "text", text: "..." }] } }
   *  3. { error: "some string" }  (top-level error without type)
   */
  private detectError(event: any): { code?: string; detail: string } | null {
    if (event.type !== "error" && !event.error) return null;

    let code: string | undefined;
    if (event.error && typeof event.error === "object") {
      code = event.error.type;
    }

    let detail: string | undefined;
    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      const textBlock = event.message.content.find((e: any) => e.type === "text" && e.text);
      if (textBlock?.text) detail = textBlock.text;
    }
    if (!detail) {
      detail = event.error?.message
        || (event.error !== "unknown" ? event.error : undefined)
        || event.message
        || JSON.stringify(event);
    }

    return { code, detail: String(detail) };
  }

  private handleEvent(taskId: string, sessionId: string, event: any, agentClient: AgentClient): void {
    // rate_limit_event — structured rate limit info from Claude CLI
    if (event.type === "rate_limit_event") {
      const info = event.rate_limit_info;
      if (info && info.status !== "allowed") {
        const resetAt = new Date(info.resetsAt * 1000).toISOString();
        console.warn(`[WARN] Claude rate limited (${info.rateLimitType}, status=${info.status}) on task ${taskId}, resets at ${resetAt}`);
        const agent = this.agents.get(taskId);
        if (agent) agent.rateLimited = true;
        this.onRateLimited(resetAt);
      }
      return;
    }

    // Error detection (covers all CLI error shapes)
    const err = this.detectError(event);
    if (err) {
      if (err.code && RATE_LIMIT_CODES.has(err.code)) {
        console.warn(`[WARN] Claude error rate limited (${err.code}) on task ${taskId}`);
        const agent = this.agents.get(taskId);
        if (agent) agent.rateLimited = true;
        // resetAt already captured from preceding rate_limit_event; fire again as fallback
        this.onRateLimited(new Date(Date.now() + 60 * 60 * 1000).toISOString());
      } else {
        console.warn(`[WARN] Claude error on task ${taskId}: ${err.detail}`);
      }
      return;
    }

    if (event.type === "assistant" && Array.isArray(event.message?.content)) {
      for (const block of event.message.content) {
        if (block.type === "text" && block.text) {
          agentClient.sendMessage(taskId, { sender_type: "agent", sender_id: agentClient.getAgentId(), content: block.text })
            .catch((e: any) => console.error(`[ERROR] Failed to send message for task ${taskId}: ${e.message}`));
        }
      }
    }
    if (event.type === "result") {
      const cost = event.total_cost_usd || 0;
      const usage = event.usage || {};
      console.log(`[INFO] Agent result for task ${taskId}: cost=$${cost.toFixed(4)}`);
      agentClient.updateSessionUsage(agentClient.getAgentId(), agentClient.getSessionId(), {
        input_tokens: usage.input_tokens || 0,
        output_tokens: usage.output_tokens || 0,
        cache_read_tokens: usage.cache_read_input_tokens || 0,
        cache_creation_tokens: usage.cache_creation_input_tokens || 0,
        cost_micro_usd: Math.round(cost * 1_000_000),
      }).catch((e: any) => console.error(`[ERROR] Failed to report usage for task ${taskId}: ${e.message}`));
    }
  }

  private async closeSession(agentClient: AgentClient): Promise<void> {
    await this.client.closeSession(agentClient.getAgentId(), agentClient.getSessionId()).catch((err: any) =>
      console.error(`[WARN] Failed to close session ${agentClient.getSessionId()}: ${err.message}`)
    );
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
