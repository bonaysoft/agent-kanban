import { expect, test } from "@playwright/test";

test.describe("Board Page", () => {
  test("Onboarding flow — 2 steps: create board then add machine", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.locator('input[placeholder="Name"]').fill("New User");
    await page.locator('input[type="email"]').fill(`onboarding_${Date.now()}@example.com`);
    await page.locator('input[type="password"]').fill("password123");
    await page.getByRole("button", { name: "Sign Up" }).click();

    await page.waitForURL(/\/boards\/_new/);

    // expect: Onboarding heading and tagline
    await expect(page.getByRole("heading", { name: "Agent Kanban" })).toBeVisible();
    await expect(page.getByText("Your AI workforce starts here.")).toBeVisible();

    // expect: 2 step indicators (not 3)
    const dots = page.locator(".rounded-full.w-2.h-2");
    await expect(dots).toHaveCount(2);

    // expect: Board name input pre-filled with "My Board"
    const boardNameInput = page.getByRole("textbox");
    await expect(boardNameInput).toHaveValue("My Board");

    // Create board
    await boardNameInput.clear();
    await boardNameInput.fill("Sprint 1");
    await page.getByRole("button", { name: "Create Board" }).click();

    // expect: Advances directly to Add Machine step (no "Create Task" step)
    await expect(page.getByText("Waiting for connection...")).toBeVisible();
    await expect(page.getByText(/npx|ak start|install/i)).toBeVisible();

    // expect: No "Create Task" button anywhere
    await expect(page.getByRole("button", { name: "Create Task" })).not.toBeVisible();
  });
});
