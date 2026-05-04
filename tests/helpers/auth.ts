import { expect, Page } from "@playwright/test";

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
  await page.getByRole("button", { name: "Sign up" }).click();
  await page.locator('input[placeholder="Name"]').fill(name);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill("password123");
  await page.getByRole("button", { name: "Sign Up" }).click();

  // Wait to land on the onboarding page
  await page.waitForURL(/\/onboarding/);
  await page.getByRole("button", { name: "Skip demo" }).click();
  await expect(page).toHaveURL(/\/boards\/new/);

  // Step 1: create the board (also creates API key, advances to step 2)
  await page.getByRole("button", { name: "Create Board" }).click();

  // Step 2 is now shown (AddMachineSteps / "Waiting for connection").
  // The board already exists in the DB — fetch the board ID and navigate directly.
  await expect(page.getByText("Waiting for connection...")).toBeVisible();

  const boardId = await page.evaluate(async () => {
    const token = localStorage.getItem("auth-token");
    const res = await fetch("/api/boards", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = (await res.json()) as { id: string }[];
    return boards[0]?.id ?? null;
  });

  if (!boardId) throw new Error("No board found after onboarding");

  await page.goto(`/boards/${boardId}`);
  await expect(page).toHaveURL(/\/boards\/.+/);
  // Wait for the board to be fully loaded (column grid visible)
  await expect(page.locator(".hidden.md\\:grid")).toBeVisible();
}
