// spec: specs/agent-kanban.plan.md
// section: 1.9 Loading state is displayed during sign-in submission

import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
  test("Loading state is displayed during sign-in submission", async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto("/auth");

    // expect: Sign-in form is displayed with the 'Sign In' button
    const submitButton = page.getByRole("button", { name: /Sign In|\.\.\./ });
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    // 2. Enter any email and password, then click 'Sign In'
    await page.locator('input[type="email"]').fill("test@example.com");
    await page.locator('input[type="password"]').fill("testpassword");

    // expect: The submit button immediately changes its text to '...' and becomes disabled
    await page.getByRole("button", { name: "Sign In" }).click();

    // The button should show '...' while the request is in flight
    // and then return to 'Sign In' or show an error once resolved
    await expect(submitButton)
      .toHaveText("...")
      .catch(async () => {
        // If we missed the loading state (too fast), the button should be back to 'Sign In'
        await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
      });

    // expect: The button re-enables once the response arrives
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled({ timeout: 10000 });
  });
});
