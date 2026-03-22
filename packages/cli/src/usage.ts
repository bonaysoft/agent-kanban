import { readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { UsageInfo } from "@agent-kanban/shared";

const CREDENTIALS_PATH = join(homedir(), ".claude", ".credentials.json");
const USAGE_API = "https://api.anthropic.com/api/oauth/usage";
const CACHE_TTL_MS = 5 * 60 * 1000;

let cachedUsage: UsageInfo | null = null;
let cachedAt = 0;

function readOAuthToken(): string | null {
  try {
    const raw = readFileSync(CREDENTIALS_PATH, "utf-8");
    const creds = JSON.parse(raw);
    return creds.claudeAiOauth?.accessToken || null;
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

    const data = await res.json() as Record<string, { utilization: number; resets_at: string }>;
    cachedUsage = {
      ...data.five_hour && { five_hour: data.five_hour },
      ...data.seven_day && { seven_day: data.seven_day },
      ...data.seven_day_sonnet && { seven_day_sonnet: data.seven_day_sonnet },
      ...data.seven_day_opus && { seven_day_opus: data.seven_day_opus },
      updated_at: new Date().toISOString(),
    };
    cachedAt = Date.now();
    return cachedUsage;
  } catch (err: any) {
    console.error(`[WARN] Failed to fetch usage: ${err.message}`);
    return cachedUsage;
  }
}
