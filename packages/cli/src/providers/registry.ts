import { execSync } from "node:child_process";
import { claudeProvider } from "./claude.js";
import { geminiProvider } from "./gemini.js";
import type { AgentProvider } from "./types.js";

const providers = new Map<string, AgentProvider>();

export function registerProvider(provider: AgentProvider): void {
  providers.set(provider.name, provider);
}

export function normalizeRuntime(runtime: string): string {
  if (runtime === "claude-code") return "claude";
  return runtime;
}

export function getProvider(name: string): AgentProvider {
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
