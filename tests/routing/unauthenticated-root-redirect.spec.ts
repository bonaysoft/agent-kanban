// spec: specs/agent-kanban.plan.md
// section: 2.1 Root URL redirects unauthenticated user to /auth

import { expect, test } from "@playwright/test";

test.describe("Routing and Navigation Guards", () => {
  test("Root URL redirects unauthenticated user to /auth", async ({ page, context }) => {
    // 1. Clear all cookies and local storage to ensure no session exists
    await context.clearCookies();
    await context.clearPermissions();

    // Navigate to /
    await page.goto("/");

    // expect: The browser is redirected to /auth
    await expect(page).toHaveURL(/\/auth/, { timeout: 5000 });

    // expect: The sign-in form is displayed
    await expect(page.getByText("Sign in to your account")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign In" })).toBeVisible();
  });
});
