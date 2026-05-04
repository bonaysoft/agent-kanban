// @vitest-environment node
import { createHash } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { createTestAgent, setupMiniflare } from "./helpers/db";

describe("agent versioning", () => {
  let mf: Awaited<ReturnType<typeof setupMiniflare>>["mf"];
  let db: D1Database;

  beforeAll(async () => {
    const setup = await setupMiniflare();
    mf = setup.mf;
    db = setup.db;
    return async () => {
      await mf.dispose();
    };
  });

  it("creates numeric versions for repeated usernames", async () => {
    const first = await createTestAgent(db, "owner-version", {
      username: "morgan-lee",
      name: "Morgan Lee",
      runtime: "codex",
      soul: "first soul",
    });
    const second = await createTestAgent(db, "owner-version", {
      username: "morgan-lee",
      name: "Morgan Lee",
      runtime: "codex",
      soul: "second soul",
    });

    expect(first.version).toBe("1");
    expect(second.version).toBe("2");
    expect(second.soul_sha1).toBe(createHash("sha1").update("second soul").digest("hex"));
  });

  it("publishes a version into the latest snapshot", async () => {
    const { publishAgent } = await import("../apps/web/server/agentRepo");
    const version = await createTestAgent(db, "owner-publish", {
      username: "riley-chen",
      name: "Riley Chen",
      runtime: "codex",
      soul: "candidate soul",
      role: "builder",
    });

    const latest = await publishAgent(db, "riley-chen", version.id, "owner-publish");

    expect(latest).toMatchObject({
      username: "riley-chen",
      version: "latest",
      soul: "candidate soul",
      role: "builder",
      soul_sha1: version.soul_sha1,
    });
    expect(latest?.id).not.toBe(version.id);
  });

  it("updates the same latest snapshot on later publish", async () => {
    const { publishAgent } = await import("../apps/web/server/agentRepo");
    const first = await createTestAgent(db, "owner-republish", {
      username: "alex-kim",
      name: "Alex Kim",
      runtime: "codex",
      soul: "first",
    });
    const latest = await publishAgent(db, "alex-kim", first.id, "owner-republish");
    const second = await createTestAgent(db, "owner-republish", {
      username: "alex-kim",
      name: "Alex Kim",
      runtime: "codex",
      soul: "second",
    });

    const updated = await publishAgent(db, "alex-kim", second.id, "owner-republish");

    expect(updated?.id).toBe(latest?.id);
    expect(updated?.version).toBe("latest");
    expect(updated?.soul).toBe("second");
    expect(updated?.soul_sha1).toBe(second.soul_sha1);
  });
});
