// spec: specs/agent-kanban.plan.md
// section: 1.8 Sign-up with existing email shows error

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('Sign-up with existing email shows error', async ({ page }) => {
    // Use a unique email per test run so the first sign-up always succeeds
    const uniqueEmail = `duplicate-test-${Date.now()}@example.com`;
    const password = 'validpassword123';

    // --- Step 1: Register the email for the first time ---
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await expect(page.getByText('Create a new account')).toBeVisible();

    await page.locator('input[placeholder="Name"]').fill('First User');
    await page.locator('input[type="email"]').fill(uniqueEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // Wait for first registration to succeed and navigate away from /auth
    await page.waitForURL('**/*', { timeout: 10000 });

    // Clear session so we can return to /auth as unauthenticated
    await page.context().clearCookies();
    await page.goto('/auth');

    // --- Step 2: Switch to sign-up mode for the duplicate attempt ---
    await page.getByRole('button', { name: 'Sign up' }).click();

    // expect: Sign-up form is displayed
    await expect(page.getByText('Create a new account')).toBeVisible();

    // --- Step 3: Enter the same email again to trigger duplicate error ---
    await page.locator('input[placeholder="Name"]').fill('Existing User');
    await page.locator('input[type="email"]').fill(uniqueEmail);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // expect: An error message is displayed indicating the email is already in use or sign-up failed
    await expect(page.locator('p.text-error')).toBeVisible({ timeout: 10000 });

    // expect: The user remains on the /auth page
    await expect(page).toHaveURL(/\/auth/);
  });
});
