// spec: specs/agent-kanban.plan.md
// section: 5.1 Settings page displays account settings

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Settings page displays account-level settings only", async ({ page }) => {
    // 1. Sign in and navigate to /settings
    await signUpAndGetBoard(page, `settings_render_${Date.now()}@example.com`);
    await page.goto("/settings");

    // expect: Page heading 'Settings' is displayed
    await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();

    // expect: A 'Theme' section is visible with three buttons: 'light', 'dark', 'system'
    await expect(page.getByRole("button", { name: "light" })).toBeVisible();
    await expect(page.getByRole("button", { name: "dark" })).toBeVisible();
    await expect(page.getByRole("button", { name: "system" })).toBeVisible();

    // expect: Account settings do not include board management UI
    await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Boards" })).not.toBeVisible();
    await expect(page.getByText("My Board")).not.toBeVisible();
  });
});
