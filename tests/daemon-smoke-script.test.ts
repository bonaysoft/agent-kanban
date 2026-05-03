// @vitest-environment node

import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "vitest";

describe("daemon smoke script", () => {
  it("has valid bash syntax", () => {
    execFileSync("bash", ["-n", join(__dirname, "../scripts/daemon-smoke-test.sh")], { stdio: "pipe" });
  });
});
