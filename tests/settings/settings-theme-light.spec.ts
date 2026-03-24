// spec: specs/agent-kanban.plan.md
// section: 5.2 Theme switcher — select light theme

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Theme switcher — select light theme", async ({ page }) => {
    // 1. Sign in and navigate to /settings
    await signUpAndGetBoard(page, `settings_light_${Date.now()}@example.com`);
    await page.goto("/settings");

    // expect: Theme buttons are visible
    const lightButton = page.getByRole("button", { name: "light" });
    await expect(lightButton).toBeVisible();

    // 2. Click the 'light' theme button
    await lightButton.click();

    // expect: The 'light' button becomes the active/selected button (shows accent border and accent text)
    await expect(lightButton).toHaveAttribute("class", /border-accent/);
  });
});
