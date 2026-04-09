/**
 * Agent environment building + GPG helpers.
 *
 * Extracted from taskRunner.ts. Pure data construction with boundary-wrapped
 * external calls for GPG import and filesystem operations.
 */

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCredentials } from "../config.js";
import { execBoundary, fsSync } from "./boundaries.js";

export interface BuildEnvOpts {
  agentId: string;
  sessionId: string;
  privateKeyJwk: JsonWebKey;
  agentName: string;
  agentUsername: string;
  gpgSubkeyId: string | null;
  gnupgHome: string | null;
}

export function buildAgentEnv(opts: BuildEnvOpts): Record<string, string> {
  const { agentId, sessionId, privateKeyJwk, agentName, agentUsername, gpgSubkeyId, gnupgHome } = opts;
  const email = `${agentUsername}@mails.agent-kanban.dev`;
  const env: Record<string, string> = {
    AK_AGENT_ID: agentId,
    AK_SESSION_ID: sessionId,
    AK_AGENT_KEY: JSON.stringify(privateKeyJwk),
    AK_API_URL: getCredentials().apiUrl,
    GIT_AUTHOR_NAME: agentName,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: agentName,
    GIT_COMMITTER_EMAIL: email,
  };
  if (gnupgHome && gpgSubkeyId) {
    env.GNUPGHOME = gnupgHome;
    env.GIT_CONFIG_COUNT = "3";
    env.GIT_CONFIG_KEY_0 = "gpg.format";
    env.GIT_CONFIG_VALUE_0 = "openpgp";
    env.GIT_CONFIG_KEY_1 = "user.signingkey";
    env.GIT_CONFIG_VALUE_1 = `${gpgSubkeyId}!`;
    env.GIT_CONFIG_KEY_2 = "commit.gpgsign";
    env.GIT_CONFIG_VALUE_2 = "true";
  }
  return env;
}

export function setupGnupgHome(armoredPrivateKey: string): string {
  const gnupgHome = fsSync("mkdtemp-gpg", () => mkdtempSync(join(tmpdir(), "ak-gpg-")));
  const keyFile = join(gnupgHome, "key.asc");
  fsSync("write-gpg-key", () => writeFileSync(keyFile, armoredPrivateKey, { mode: 0o600 }));
  execBoundary("gpg-import", () =>
    execFileSync("gpg", ["--batch", "--import", keyFile], {
      env: { ...process.env, GNUPGHOME: gnupgHome },
      stdio: "pipe",
    }),
  );
  fsSync("rm-gpg-keyfile", () => rmSync(keyFile));
  return gnupgHome;
}

export function cleanupGnupgHome(gnupgHome: string | null): void {
  if (!gnupgHome) return;
  fsSync("rm-gnupghome", () => rmSync(gnupgHome, { recursive: true, force: true }));
}
