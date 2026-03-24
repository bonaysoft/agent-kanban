// spec: specs/agent-kanban.plan.md
// section: 1.2 Switch between sign-in and sign-up modes

import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
  test("Switch between sign-in and sign-up modes", async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto("/auth");

    // expect: Page is in sign-in mode, subtitle reads 'Sign in to your account'
    await expect(page.getByText("Sign in to your account")).toBeVisible();

    // 2. Click the 'Sign up' toggle link at the bottom of the form
    await page.getByRole("button", { name: "Sign up" }).click();

    // expect: The form switches to sign-up mode
    // expect: Subtitle changes to 'Create a new account'
    await expect(page.getByText("Create a new account")).toBeVisible();

    // expect: A 'Name' input field appears above the email field
    await expect(page.locator('input[placeholder="Name"]')).toBeVisible();

    // expect: The submit button label changes to 'Sign Up'
    await expect(page.getByRole("button", { name: "Sign Up" })).toBeVisible();

    // expect: The toggle link at the bottom changes to 'Sign in'
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // 3. Click the 'Sign in' toggle link at the bottom
    await page.getByRole("button", { name: "Sign in" }).click();

    // expect: The form switches back to sign-in mode
    // expect: The Name field disappears
    await expect(page.locator('input[placeholder="Name"]')).not.toBeVisible();

    // expect: Subtitle returns to 'Sign in to your account'
    await expect(page.getByText("Sign in to your account")).toBeVisible();

    // expect: Submit button label returns to 'Sign In'
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });
});
