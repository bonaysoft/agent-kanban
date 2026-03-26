import { execSync } from "node:child_process";
import type { AgentRuntime } from "@agent-kanban/shared";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import { geminiProvider } from "./gemini.js";
import type { AgentProvider } from "./types.js";

const providers = new Map<AgentRuntime, AgentProvider>();

/** Legacy alias map for old runtime names */
const RUNTIME_ALIASES: Record<string, AgentRuntime> = {
  "claude-code": "claude",
  "codex-cli": "codex",
};

export function registerProvider(provider: AgentProvider): void {
  providers.set(provider.name, provider);
}

export function normalizeRuntime(runtime: string): AgentRuntime {
  return RUNTIME_ALIASES[runtime] ?? (runtime as AgentRuntime);
}

export function getProvider(name: AgentRuntime): AgentProvider {
  const provider = providers.get(name);
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Available: ${[...providers.keys()].join(", ")}`);
  }
  return provider;
}

export function getAvailableProviders(): AgentProvider[] {
  return [...providers.values()].filter((p) => {
    try {
      execSync(`which ${p.command}`, { stdio: "ignore" });
      return true;
    } catch {
      return false;
    }
  });
}

// Auto-register built-in providers
registerProvider(claudeProvider);
registerProvider(geminiProvider);
registerProvider(codexProvider);
