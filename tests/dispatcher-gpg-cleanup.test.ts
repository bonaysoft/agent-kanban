// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const execFileSyncMock = vi.fn();
const rmSyncMock = vi.fn();

vi.mock("node:child_process", () => ({
  execFileSync: execFileSyncMock,
}));

vi.mock("node:fs", async () => {
  const actual = await vi.importActual<typeof import("node:fs")>("node:fs");
  return {
    ...actual,
    rmSync: rmSyncMock,
  };
});

describe("cleanupGnupgHome", () => {
  beforeEach(() => {
    execFileSyncMock.mockReset();
    rmSyncMock.mockReset();
    vi.resetModules();
  });

  it("kills the gpg-agent for the temp GNUPGHOME before removing the directory", async () => {
    const { cleanupGnupgHome } = await import("../packages/cli/src/daemon/dispatcher.js");
    const gnupgHome = "/tmp/ak-gpg-test";

    cleanupGnupgHome(gnupgHome);

    expect(execFileSyncMock).toHaveBeenCalledWith(
      "gpgconf",
      ["--kill", "gpg-agent"],
      expect.objectContaining({
        stdio: "pipe",
        env: expect.objectContaining({ GNUPGHOME: gnupgHome }),
      }),
    );
    expect(rmSyncMock).toHaveBeenCalledWith(gnupgHome, { recursive: true, force: true });
    expect(execFileSyncMock.mock.invocationCallOrder[0]).toBeLessThan(rmSyncMock.mock.invocationCallOrder[0]);
  });

  it("does nothing when GNUPGHOME is null", async () => {
    const { cleanupGnupgHome } = await import("../packages/cli/src/daemon/dispatcher.js");

    cleanupGnupgHome(null);

    expect(execFileSyncMock).not.toHaveBeenCalled();
    expect(rmSyncMock).not.toHaveBeenCalled();
  });
});
