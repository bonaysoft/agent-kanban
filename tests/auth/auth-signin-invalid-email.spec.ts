// spec: specs/agent-kanban.plan.md
// section: 1.4 Sign-in form validation — invalid email format

import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
  test("Sign-in form validation — invalid email format", async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto("/auth");

    // expect: Sign-in form is displayed
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();

    // 2. Type 'notanemail' into the email field and 'password123' into the password field
    await page.locator('input[type="email"]').fill("notanemail");
    await page.locator('input[type="password"]').fill("password123");

    // Click 'Sign In'
    await page.getByRole("button", { name: "Sign In" }).click();

    // expect: The form does not submit (browser native email validation blocks it)
    // expect: Page remains on /auth
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByText("Sign in to your account")).toBeVisible();
  });
});
