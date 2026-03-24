// spec: specs/agent-kanban.plan.md
// section: 1.5 Sign-in with wrong credentials shows error

import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
  test("Sign-in with wrong credentials shows error", async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto("/auth");

    // expect: Sign-in form is displayed
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    // 2. Enter 'wrong@example.com' in the email field and 'wrongpassword' in the password field
    await page.locator('input[type="email"]').fill("wrong@example.com");
    await page.locator('input[type="password"]').fill("wrongpassword");

    // 3. Click the 'Sign In' button
    await page.getByRole("button", { name: "Sign In" }).click();

    // expect: The submit button changes to '...' during loading, then returns
    // expect: An error message is displayed (styled with text-error class)
    await expect(page.locator("p.text-error")).toBeVisible({ timeout: 10000 });

    // expect: The user remains on the /auth page
    await expect(page).toHaveURL(/\/auth/);

    // expect: The submit button returns from loading state back to 'Sign In'
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeEnabled();
  });
});
