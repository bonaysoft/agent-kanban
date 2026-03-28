// @vitest-environment node

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestAgent, createTestEnv, seedUser, setupMiniflare } from "./helpers/db";

const env = createTestEnv();
let mf: Miniflare;

async function apiRequest(method: string, path: string) {
  const { api } = await import("../apps/web/functions/api/routes");
  const headers: Record<string, string> = { Host: "localhost:8788", "x-forwarded-proto": "http" };
  return api.request(path, { method, headers }, env);
}

async function wkdHash(localPart: string): Promise<string> {
  const ZBASE32 = "ybndrfg8ejkmcpqxot1uwisza345h769";
  const data = new TextEncoder().encode(localPart.toLowerCase());
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-1", data));
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of hash) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ZBASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ZBASE32[(value << (5 - bits)) & 31];
  return out;
}

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
});

afterAll(async () => {
  await mf.dispose();
});

describe("public GPG key endpoints", () => {
  const userId = "gpg-route-test-user";
  let agentUsername: string;

  beforeAll(async () => {
    await seedUser(env.DB, userId, "gpg-route-test@test.com");
    agentUsername = "gpg-test-agent";
    await createTestAgent(env.DB, userId, { name: "GPG Test Agent", username: agentUsername, runtime: "claude" });
  });

  // ─── GET /agents/:username.gpg ───

  it("returns armored GPG public key for known agent username", async () => {
    const res = await apiRequest("GET", `/agents/${agentUsername}.gpg`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
  });

  it("returns Content-Type application/pgp-keys for GPG endpoint", async () => {
    const res = await apiRequest("GET", `/agents/${agentUsername}.gpg`);
    expect(res.headers.get("Content-Type")).toBe("application/pgp-keys");
  });

  it("returns Cache-Control header for GPG endpoint", async () => {
    const res = await apiRequest("GET", `/agents/${agentUsername}.gpg`);
    expect(res.headers.get("Cache-Control")).toBe("public, max-age=3600");
  });

  it("returns 404 for unknown agent username on GPG endpoint", async () => {
    const res = await apiRequest("GET", "/agents/nonexistent-agent.gpg");
    expect(res.status).toBe(404);
  });

  it("requires no auth for GPG public key endpoint", async () => {
    // No token passed — must succeed (200) for known agent
    const res = await apiRequest("GET", `/agents/${agentUsername}.gpg`);
    expect(res.status).toBe(200);
  });

  // ─── GET /.well-known/openpgpkey/hu/:hash ───

  it("returns armored GPG public key via WKD hash endpoint", async () => {
    const hash = await wkdHash(agentUsername);
    const res = await apiRequest("GET", `/.well-known/openpgpkey/hu/${hash}?l=${agentUsername}`);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("-----BEGIN PGP PUBLIC KEY BLOCK-----");
  });

  it("returns Content-Type application/pgp-keys for WKD endpoint", async () => {
    const hash = await wkdHash(agentUsername);
    const res = await apiRequest("GET", `/.well-known/openpgpkey/hu/${hash}?l=${agentUsername}`);
    expect(res.headers.get("Content-Type")).toBe("application/pgp-keys");
  });

  it("returns 400 when l= query parameter is missing on WKD endpoint", async () => {
    const hash = await wkdHash(agentUsername);
    const res = await apiRequest("GET", `/.well-known/openpgpkey/hu/${hash}`);
    expect(res.status).toBe(400);
  });

  it("returns 404 for unknown agent username on WKD endpoint", async () => {
    const hash = await wkdHash("no-such-agent");
    const res = await apiRequest("GET", `/.well-known/openpgpkey/hu/${hash}?l=no-such-agent`);
    expect(res.status).toBe(404);
  });

  it("returns 404 when hash does not match the local part on WKD endpoint", async () => {
    const wrongHash = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const res = await apiRequest("GET", `/.well-known/openpgpkey/hu/${wrongHash}?l=${agentUsername}`);
    expect(res.status).toBe(404);
  });

  it("requires no auth for WKD endpoint", async () => {
    const hash = await wkdHash(agentUsername);
    const res = await apiRequest("GET", `/.well-known/openpgpkey/hu/${hash}?l=${agentUsername}`);
    expect(res.status).toBe(200);
  });

  // ─── GET /.well-known/openpgpkey/policy ───

  it("returns 200 for WKD policy endpoint", async () => {
    const res = await apiRequest("GET", "/.well-known/openpgpkey/policy");
    expect(res.status).toBe(200);
  });

  it("returns empty body for WKD policy endpoint", async () => {
    const res = await apiRequest("GET", "/.well-known/openpgpkey/policy");
    const body = await res.text();
    expect(body).toBe("");
  });

  it("returns text/plain Content-Type for WKD policy endpoint", async () => {
    const res = await apiRequest("GET", "/.well-known/openpgpkey/policy");
    expect(res.headers.get("Content-Type")).toContain("text/plain");
  });

  it("requires no auth for WKD policy endpoint", async () => {
    // No token — must succeed without auth
    const res = await apiRequest("GET", "/.well-known/openpgpkey/policy");
    expect(res.status).toBe(200);
  });

  // ─── Old /api/gpg/public-key endpoint is gone ───

  it("GET /api/gpg/public-key returns 401 or 404 (endpoint removed)", async () => {
    const res = await apiRequest("GET", "/api/gpg/public-key");
    expect([401, 404]).toContain(res.status);
  });
});
