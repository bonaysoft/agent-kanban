import { execSync } from "node:child_process";
import { type AgentRuntime, normalizeRuntime } from "@agent-kanban/shared";
import { claudeProvider } from "./claude.js";
import { codexProvider } from "./codex.js";
import { copilotProvider } from "./copilot.js";
import { geminiProvider } from "./gemini.js";
import type { AgentProvider } from "./types.js";

export { normalizeRuntime };

const providers = new Map<AgentRuntime, AgentProvider>();

/** Binary name used to detect availability per runtime */
const RUNTIME_COMMANDS: Record<AgentRuntime, string> = {
  claude: "claude",
  codex: "codex",
  gemini: "gemini",
  copilot: "copilot",
};

export function registerProvider(provider: AgentProvider): void {
  providers.set(provider.name, provider);
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
    const command = RUNTIME_COMMANDS[p.name];
    try {
      execSync(`which ${command}`, { stdio: "ignore" });
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
registerProvider(copilotProvider);
