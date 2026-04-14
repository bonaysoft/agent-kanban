import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { getCredentials } from "../config.js";
import { generateDeviceId } from "../device.js";
import { IDENTITIES_DIR } from "../paths.js";

export interface StoredIdentity {
  agent_id: string;
  name: string;
  fingerprint: string;
}

function legacyIdentityPath(runtime: string): string {
  return join(IDENTITIES_DIR, `${runtime}.json`);
}

function scopedIdentityPath(runtime: string): string {
  const { apiUrl } = getCredentials();
  const deviceId = generateDeviceId();
  const scope = createHash("sha256").update(`${apiUrl}\n${deviceId}\n${runtime}`).digest("hex").slice(0, 16);
  return join(IDENTITIES_DIR, `${runtime}-${scope}.json`);
}

export function loadIdentity(runtime: string): StoredIdentity | null {
  try {
    return JSON.parse(readFileSync(scopedIdentityPath(runtime), "utf-8"));
  } catch {}

  // Migrate the old runtime-only identity on first access into the new
  // api-url + machine + runtime scoped location.
  try {
    const identity = JSON.parse(readFileSync(legacyIdentityPath(runtime), "utf-8")) as StoredIdentity;
    saveIdentity(runtime, identity);
    return identity;
  } catch {}

  return null;
}

export function saveIdentity(runtime: string, identity: StoredIdentity): void {
  mkdirSync(IDENTITIES_DIR, { recursive: true });
  writeFileSync(scopedIdentityPath(runtime), `${JSON.stringify(identity, null, 2)}\n`);
}

export function removeIdentity(runtime: string): boolean {
  let removed = false;
  for (const path of [scopedIdentityPath(runtime), legacyIdentityPath(runtime)]) {
    try {
      rmSync(path);
      removed = true;
    } catch {
      // ignore
    }
  }
  return removed;
}
