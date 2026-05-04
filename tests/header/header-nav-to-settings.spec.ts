// spec: specs/agent-kanban.plan.md
// section: 4.4 Navigate to settings via avatar dropdown

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Header and Navigation", () => {
  test("Navigate to settings via avatar dropdown", async ({ page }) => {
    // 1. Sign in, click the user avatar, and then click 'Settings' in the dropdown
    await signUpAndGetBoard(page, `headersettings_${Date.now()}@example.com`);

    const header = page.locator("header");
    const avatarButton = header.locator("button.rounded-full");
    await avatarButton.click();

    const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdown).toBeVisible();
    await dropdown.getByRole("menuitem", { name: "Settings" }).click();

    // expect: The user is navigated to /settings
    await expect(page).toHaveURL(/\/settings/);

    // expect: The Settings page is displayed with account-level settings
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Theme" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "GitHub" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Boards" })).not.toBeVisible();
  });
});
