import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { expect, Page } from "@playwright/test";

const d1Dir = join(process.cwd(), "apps/web/.wrangler/state/v3/d1/miniflare-D1DatabaseObject");

/**
 * Signs up a new user and completes the onboarding flow (2 steps),
 * then navigates to the actual board page at /boards/:id.
 *
 * Onboarding steps:
 *   0 - DemoBoard (skip to board creation)
 *   1 - Create Board (board name input + "Create Board" button, also creates API key)
 *   2 - AddMachineSteps (shows API key + "Waiting for connection..." - no skip)
 *
 * After step 0 completes, the board exists. We fetch the board list via the API
 * and navigate directly instead of waiting for a machine to connect.
 */
export async function signUpAndGetBoard(page: Page, email: string, name = "Test User"): Promise<void> {
  await page.goto("/auth");
  const origin = new URL(page.url()).origin;
  const res = await fetch(`${origin}/api/auth/sign-up/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ name, email, password: "password123" }),
  });
  if (!res.ok) throw new Error(`Sign up failed: ${res.status} ${await res.text()}`);

  markEmailVerified(email);
  const signInRes = await fetch(`${origin}/api/auth/sign-in/email`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
    },
    body: JSON.stringify({ email, password: "password123" }),
  });
  if (!signInRes.ok) throw new Error(`Sign in failed: ${signInRes.status} ${await signInRes.text()}`);

  const token = signInRes.headers.get("set-auth-token");
  const cookie = sessionCookie(signInRes);
  if (!token || !cookie) throw new Error("Sign in did not return a session");

  await page.context().addCookies([{ name: cookie.name, value: cookie.value, url: origin }]);
  await page.evaluate((authToken) => localStorage.setItem("auth-token", authToken), token);
  await page.goto("/onboarding");

  // Wait to land on the onboarding page
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "Skip demo" }).click();
  await expect(page).toHaveURL(/\/boards\/new/);

  // Step 1: create the board (also creates API key, advances to step 2)
  await page.getByRole("button", { name: "Create Board" }).click();

  await expect.poll(() => firstBoardId(page)).not.toBeNull();
  const boardId = await firstBoardId(page);

  if (!boardId) throw new Error("No board found after onboarding");

  await page.goto(`/boards/${boardId}`);
  await expect(page).toHaveURL(/\/boards\/.+/);
  // Wait for the board to be fully loaded (column grid visible)
  await expect(page.locator(".hidden.md\\:grid")).toBeVisible();
}

async function firstBoardId(page: Page): Promise<string | null> {
  return page.evaluate(async () => {
    const token = localStorage.getItem("auth-token");
    const res = await fetch("/api/boards", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = (await res.json()) as { id: string }[];
    return boards[0]?.id ?? null;
  });
}

function markEmailVerified(email: string) {
  execFileSync("sqlite3", ["-cmd", ".timeout 10000", d1DatabasePath(), `UPDATE user SET emailVerified = 1 WHERE email = '${sqlString(email)}';`]);
}

function d1DatabasePath(): string {
  const db = readdirSync(d1Dir).find((file) => file.endsWith(".sqlite") && file !== "metadata.sqlite");
  if (!db) throw new Error("Local D1 database not found");
  return join(d1Dir, db);
}

function sessionCookie(res: Response): { name: string; value: string } | null {
  const raw = res.headers.get("set-cookie");
  const pair = raw?.split(";")[0];
  if (!pair) return null;
  const [name, value] = pair.split("=");
  return { name, value: decodeURIComponent(value) };
}

function sqlString(value: string): string {
  return value.replace(/'/g, "''");
}
