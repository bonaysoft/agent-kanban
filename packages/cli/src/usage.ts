import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir, platform } from "node:os";
import { join } from "node:path";
import type { UsageInfo } from "./types.js";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedUsage: UsageInfo | null = null;
let cachedAt = 0;
let cachedToken: string | null = null;

function parseToken(raw: string): string | null {
  const creds = JSON.parse(raw);
  return creds.claudeAiOauth?.accessToken || null;
}

function readOAuthToken(): string | null {
  if (cachedToken) return cachedToken;
  try {
    if (platform() === "darwin") {
      const raw = execSync('security find-generic-password -s "Claude Code-credentials" -w', {
        stdio: ["pipe", "pipe", "pipe"],
      })
        .toString()
        .trim();
      cachedToken = parseToken(raw);
    } else {
      cachedToken = parseToken(readFileSync(CREDENTIALS_PATH, "utf-8"));
    }
    return cachedToken;
  } catch {
    return null;
  }
}

export async function getUsage(): Promise<UsageInfo | null> {
  if (cachedUsage && Date.now() - cachedAt < CACHE_TTL_MS) {
    return cachedUsage;
  }

  const token = readOAuthToken();
  if (!token) return cachedUsage;

  try {
    const res = await fetch(USAGE_API, {
      headers: {
        Authorization: `Bearer ${token}`,
        "anthropic-beta": "oauth-2025-04-20",
      },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      console.error(`[WARN] Usage API returned ${res.status}`);
      return cachedUsage;
    }

    const data = (await res.json()) as Record<string, { utilization: number; resets_at: string }>;
    cachedUsage = {
      ...(data.five_hour && { five_hour: data.five_hour }),
      ...(data.seven_day && { seven_day: data.seven_day }),
      ...(data.seven_day_sonnet && { seven_day_sonnet: data.seven_day_sonnet }),
      ...(data.seven_day_opus && { seven_day_opus: data.seven_day_opus }),
      updated_at: new Date().toISOString(),
    };
    cachedAt = Date.now();
    return cachedUsage;
  } catch (err: any) {
    console.error(`[WARN] Failed to fetch usage: ${err.message}`);
    return cachedUsage;
  }
}
