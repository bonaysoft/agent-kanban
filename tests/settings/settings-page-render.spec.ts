// spec: specs/agent-kanban.plan.md
// section: 5.1 Settings page displays theme switcher and boards list

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Settings page displays theme switcher and boards list", async ({ page }) => {
    // 1. Sign in and navigate to /settings
    await signUpAndGetBoard(page, `settings_render_${Date.now()}@example.com`);
    await page.goto("/settings");

    // expect: Page heading 'Settings' is displayed
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    // expect: A 'Theme' section is visible with three buttons: 'light', 'dark', 'system'
    await expect(page.getByRole("button", { name: "light" })).toBeVisible();
    await expect(page.getByRole("button", { name: "dark" })).toBeVisible();
    await expect(page.getByRole("button", { name: "system" })).toBeVisible();

    // expect: A 'Boards' section is visible listing all user boards
    await expect(page.getByText("My Board")).toBeVisible();
  });
});
