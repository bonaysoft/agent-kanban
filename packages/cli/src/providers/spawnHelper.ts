import { type ChildProcess, spawn } from "node:child_process";
import type { AgentEvent, AgentHandle } from "./types.js";

export interface SpawnAgentOpts {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  input?: string;
  parseEvent: (raw: string) => AgentEvent | null;
}

export function spawnAgent(opts: SpawnAgentOpts): AgentHandle {
  const proc = spawn(opts.command, opts.args, {
    cwd: opts.cwd,
    stdio: ["pipe", "pipe", "pipe"],
    env: opts.env,
  });

  if (opts.input && proc.stdin) {
    proc.stdin.write(`${opts.input}\n`);
    // Keep stdin open for send()
  }

  let stderrBuffer = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderrBuffer += chunk.toString();
    if (stderrBuffer.length > 50000) stderrBuffer = stderrBuffer.slice(-25000);
  });

  const events = createEventStream(proc, opts.parseEvent, () => stderrBuffer);

  return {
    events,
    pid: proc.pid ?? null,
    abort: () => terminateProcess(proc),
    send: async (message: string) => {
      if (proc.stdin && !proc.stdin.destroyed) {
        proc.stdin.write(`${message}\n`);
      }
    },
  };
}

async function* createEventStream(
  proc: ChildProcess,
  parseEvent: (raw: string) => AgentEvent | null,
  getStderr: () => string,
): AsyncGenerator<AgentEvent> {
  let buffer = "";
  const queue: AgentEvent[] = [];
  let done = false;
  let exitCode: number | null = null;
  let exitError: Error | null = null;
  let resolve: (() => void) | null = null;

  const signal = () => resolve?.();

  proc.stdout?.on("data", (chunk: Buffer) => {
    buffer += chunk.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const event = parseEvent(line);
      if (event) {
        queue.push(event);
        signal();
      }
    }
  });

  proc.on("close", (code) => {
    // Flush remaining buffer
    if (buffer.trim()) {
      const event = parseEvent(buffer);
      if (event) queue.push(event);
    }
    exitCode = code;
    done = true;
    signal();
  });

  proc.on("error", (err) => {
    exitError = err;
    done = true;
    signal();
  });

  while (true) {
    while (queue.length > 0) {
      yield queue.shift()!;
    }

    if (done) break;

    await new Promise<void>((r) => {
      resolve = r;
    });
    resolve = null;
  }

  if (exitError) {
    throw exitError;
  }

  if (exitCode !== null && exitCode !== 0) {
    const stderr = getStderr().trim().split("\n").slice(-10).join("\n");
    const err = new Error(`Process exited with code ${exitCode}`);
    (err as any).exitCode = exitCode;
    (err as any).stderr = stderr;
    throw err;
  }
}

function terminateProcess(proc: ChildProcess): Promise<void> {
  return new Promise((resolve) => {
    if (!proc.pid || proc.killed) {
      resolve();
      return;
    }

    const onExit = () => {
      clearTimeout(killTimer);
      resolve();
    };
    proc.once("close", onExit);
    proc.kill("SIGTERM");

    const killTimer = setTimeout(() => {
      proc.removeListener("close", onExit);
      if (!proc.killed) proc.kill("SIGKILL");
      resolve();
    }, 5000);
  });
}
