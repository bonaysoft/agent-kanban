import { execFileSync } from "node:child_process";

interface RuntimeSpec {
  /** Environment variable set by the runtime when it spawns subprocesses. */
  envVar: string;
  commandPattern: RegExp;
}

const RUNTIMES: Record<string, RuntimeSpec> = {
  claude: { envVar: "CLAUDECODE", commandPattern: /(^|\/)claude(\s|$)/ },
  codex: { envVar: "CODEX_CI", commandPattern: /(^|\/)codex(\s|$)/ },
  gemini: { envVar: "GEMINI_CLI", commandPattern: /(^|\/)gemini(\s|$)/ },
  copilot: { envVar: "COPILOT_CLI", commandPattern: /(^|\/)copilot(\s|$)/ },
  hermes: { envVar: "HERMES_INTERACTIVE", commandPattern: /(^|\/)hermes(\s|$)/ },
};

export function detectRuntime(): string | null {
  for (const [name, { envVar }] of Object.entries(RUNTIMES)) {
    if (process.env[envVar]) return name;
  }
  return null;
}

function readProcess(pid: number): { ppid: number; command: string } | null {
  try {
    const out = execFileSync("ps", ["-p", String(pid), "-o", "ppid=,command="], { encoding: "utf-8" }).trim();
    if (!out) return null;
    const match = out.match(/^\s*(\d+)\s+(.*)$/);
    if (!match) return null;
    return { ppid: Number(match[1]), command: match[2] };
  } catch {
    return null;
  }
}

/**
 * Walk up the process ancestry from `ak` to find the long-lived agent runtime
 * process (claude/codex/gemini) that ultimately invoked us. Returns its PID, or
 * null if no matching ancestor is found.
 *
 * Used to anchor leader sessions to a stable, long-lived PID instead of the
 * ephemeral shell that spawned `ak` (which dies in milliseconds and causes the
 * daemon to immediately reap the session).
 */
export function findRuntimeAncestorPid(runtime: string): number | null {
  const pattern = RUNTIMES[runtime]?.commandPattern;
  if (!pattern) return null;
  let pid = process.ppid;
  for (let i = 0; i < 32 && pid > 1; i++) {
    const info = readProcess(pid);
    if (!info) return null;
    if (pattern.test(info.command)) return pid;
    pid = info.ppid;
  }
  return null;
}
