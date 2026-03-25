const RUNTIME_ENV: Record<string, string> = {
  CLAUDECODE: "claude",
  CODEX_CI: "codex",
  GEMINI_CLI: "gemini",
};

export function detectRuntime(): string | null {
  for (const [envVar, name] of Object.entries(RUNTIME_ENV)) {
    if (process.env[envVar]) return name;
  }
  return null;
}
