import { afterEach, describe, expect, it } from "vitest";
import { getAvailableProviders, getProvider, registerProvider, resetRegistry } from "../src/providers/registry.js";
import type { AgentProvider } from "../src/providers/types.js";

// Minimal stub provider for test registration
function makeProvider(name: string, command = "echo"): AgentProvider {
  return {
    name,
    label: `Label for ${name}`,
    command,
    buildArgs: () => [],
    buildResumeArgs: () => [],
    parseEvent: () => null,
    buildInput: (ctx) => ctx,
  };
}

describe("registry", () => {
  afterEach(() => {
    resetRegistry();
  });

  describe("getProvider", () => {
    it("returns claudeProvider which is auto-registered on import", () => {
      const provider = getProvider("claude");
      expect(provider.name).toBe("claude");
    });

    it("throws for unknown provider name", () => {
      expect(() => getProvider("nonexistent-xyz")).toThrow(/Unknown provider/);
    });

    it("error message includes the unknown name", () => {
      expect(() => getProvider("ghost")).toThrow(/"ghost"/);
    });

    it("error message lists available providers", () => {
      expect(() => getProvider("ghost")).toThrow(/Available:/);
    });
  });

  describe("registerProvider", () => {
    const testProviderName = "test-provider-unique-1";

    it("registers a new provider and makes it retrievable", () => {
      const provider = makeProvider(testProviderName);
      registerProvider(provider);
      expect(getProvider(testProviderName)).toBe(provider);
    });

    it("overwrites an existing provider with the same name", () => {
      const first = makeProvider("overwrite-test");
      const second = makeProvider("overwrite-test");
      registerProvider(first);
      registerProvider(second);
      expect(getProvider("overwrite-test")).toBe(second);
    });
  });

  describe("getAvailableProviders", () => {
    it("returns an array", () => {
      const result = getAvailableProviders();
      expect(Array.isArray(result)).toBe(true);
    });

    it("only includes providers whose command exists on PATH", () => {
      // Register a provider with a command that definitely does not exist
      registerProvider(makeProvider("unavailable-provider", "this-command-surely-does-not-exist-xyz123"));
      const available = getAvailableProviders();
      const names = available.map((p) => p.name);
      expect(names).not.toContain("unavailable-provider");
    });

    it("includes providers whose command is available on PATH", () => {
      // 'echo' is universally available
      const echoProvider = makeProvider("echo-provider", "echo");
      registerProvider(echoProvider);
      const available = getAvailableProviders();
      const names = available.map((p) => p.name);
      expect(names).toContain("echo-provider");
    });

    it("returns only AgentProvider objects", () => {
      const available = getAvailableProviders();
      for (const p of available) {
        expect(typeof p.name).toBe("string");
        expect(typeof p.command).toBe("string");
        expect(typeof p.buildArgs).toBe("function");
      }
    });
  });
});
