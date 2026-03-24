// spec: specs/agent-kanban.plan.md
// section: 1.6 Sign-up form validation — password minimum length

import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
  test("Sign-up form validation — password minimum length", async ({ page }) => {
    // 1. Navigate to /auth and click the 'Sign up' link to switch to sign-up mode
    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign up" }).click();

    // expect: Sign-up form is displayed with Name, Email, and Password fields
    await expect(page.locator('input[placeholder="Name"]')).toBeVisible();
    await expect(page.locator('input[type="email"]')).toBeVisible();
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // 2. Enter 'Test User' in Name, 'test@example.com' in Email, 'short' in Password, then click 'Sign Up'
    await page.locator('input[placeholder="Name"]').fill("Test User");
    await page.locator('input[type="email"]').fill("test@example.com");
    await page.locator('input[type="password"]').fill("short");
    await page.getByRole("button", { name: "Sign Up" }).click();

    // expect: The form does not submit
    // expect: Browser native minlength validation fires (password has minLength=8)
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByText("Create a new account")).toBeVisible();
  });
});
