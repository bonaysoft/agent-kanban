// spec: specs/agent-kanban.plan.md
// section: 5.3 Theme switcher — select dark theme

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Theme switcher — select dark theme", async ({ page }) => {
    // 1. Sign in and navigate to /settings. Click the 'dark' theme button.
    await signUpAndGetBoard(page, `settings_dark_${Date.now()}@example.com`);
    await page.goto("/settings");

    const darkButton = page.getByRole("button", { name: "dark" });
    await expect(darkButton).toBeVisible();

    await darkButton.click();

    // expect: The 'dark' button is highlighted as active
    await expect(darkButton).toHaveAttribute("class", /border-accent/);
  });
});
