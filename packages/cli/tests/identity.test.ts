// @vitest-environment node

import { mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const testStateDir = join(tmpdir(), `ak-identity-test-${Date.now()}`);
const mockGetCredentials = vi.fn(() => ({ apiUrl: "https://api.one.test", apiKey: "key-1" }));
const mockGenerateDeviceId = vi.fn(() => "device-123");

vi.mock("../src/paths.js", async () => {
  const actual = await vi.importActual<typeof import("../src/paths.js")>("../src/paths.js");
  return {
    ...actual,
    IDENTITIES_DIR: testStateDir,
  };
});

vi.mock("../src/config.js", () => ({
  getCredentials: mockGetCredentials,
}));

vi.mock("../src/device.js", () => ({
  generateDeviceId: mockGenerateDeviceId,
}));

async function freshIdentityModule() {
  await vi.resetModules();
  return import("../src/agent/identity.js");
}

beforeEach(() => {
  mkdirSync(testStateDir, { recursive: true });
  mockGetCredentials.mockReturnValue({ apiUrl: "https://api.one.test", apiKey: "key-1" });
  mockGenerateDeviceId.mockReturnValue("device-123");
});

afterEach(async () => {
  await import("node:fs").then(({ rmSync }) => rmSync(testStateDir, { recursive: true, force: true }));
  vi.clearAllMocks();
});

describe("identity storage", () => {
  it("scopes identity by api-url + machine + runtime", async () => {
    const mod = await freshIdentityModule();
    mod.saveIdentity("claude", { agent_id: "agent-1", name: "Alex", fingerprint: "fp-1" });

    expect(mod.loadIdentity("claude")).toEqual({ agent_id: "agent-1", name: "Alex", fingerprint: "fp-1" });

    mockGetCredentials.mockReturnValue({ apiUrl: "https://api.two.test", apiKey: "key-2" });
    expect(mod.loadIdentity("claude")).toBeNull();
  });

  it("migrates legacy runtime-only identity into the scoped location", async () => {
    const mod = await freshIdentityModule();
    const legacyPath = join(testStateDir, "claude.json");
    const legacy = { agent_id: "agent-legacy", name: "Legacy Alex", fingerprint: "fp-legacy" };
    await import("node:fs").then(({ writeFileSync }) => writeFileSync(legacyPath, `${JSON.stringify(legacy, null, 2)}\n`));

    expect(mod.loadIdentity("claude")).toEqual(legacy);

    const files = await import("node:fs").then(({ readdirSync }) => readdirSync(testStateDir));
    const scoped = files.find((name) => name.startsWith("claude-") && name.endsWith(".json"));
    expect(scoped).toBeTruthy();
    const scopedBody = JSON.parse(readFileSync(join(testStateDir, scoped!), "utf-8"));
    expect(scopedBody).toEqual(legacy);
  });
});
