// spec: specs/agent-kanban.plan.md
// section: 5.9 Board item — Open link navigates to board

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Board item — Open link navigates to board", async ({ page }) => {
    // 1. Sign in, navigate to /settings, find a board item in the list
    await signUpAndGetBoard(page, `settings_openlink_${Date.now()}@example.com`);
    await page.goto("/settings");

    // expect: An 'Open' link is visible on the right side of the collapsed board row
    const openButton = page.getByRole("button", { name: "Open" });
    await expect(openButton).toBeVisible();

    // 2. Click 'Open'
    await openButton.click();

    // expect: The user is navigated to /boards/:boardId
    await expect(page).toHaveURL(/\/boards\/.+/);

    // expect: The board page for that board is displayed
    await expect(page.locator(".hidden.md\\:grid")).toBeVisible();
  });
});
