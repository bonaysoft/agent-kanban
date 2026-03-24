// spec: specs/agent-kanban.plan.md
// section: 5.4 Theme switcher — select system theme

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Theme switcher — select system theme", async ({ page }) => {
    // 1. Sign in and navigate to /settings. Click the 'system' theme button.
    await signUpAndGetBoard(page, `settings_system_${Date.now()}@example.com`);
    await page.goto("/settings");

    const systemButton = page.getByRole("button", { name: "system" });
    await expect(systemButton).toBeVisible();

    await systemButton.click();

    // expect: The 'system' button is highlighted as active
    await expect(systemButton).toHaveAttribute("class", /border-accent/);
  });
});
