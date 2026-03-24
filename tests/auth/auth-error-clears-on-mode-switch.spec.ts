// spec: specs/agent-kanban.plan.md
// section: 1.11 Error is cleared when switching auth modes

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('Error is cleared when switching auth modes', async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto('/auth');

    // expect: Sign-in form is displayed
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    // 2. Attempt to sign in with 'bad@example.com' and 'badpassword' to produce an error message
    await page.locator('input[type="email"]').fill('bad@example.com');
    await page.locator('input[type="password"]').fill('badpassword');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // expect: An error message is displayed in the form
    await expect(page.locator('p.text-error')).toBeVisible({ timeout: 10000 });

    // 3. Click the 'Sign up' toggle link to switch to sign-up mode
    await page.getByRole('button', { name: 'Sign up' }).click();

    // expect: The error message is no longer visible (setError(null) is called on mode switch)
    await expect(page.locator('p.text-error')).not.toBeVisible();

    // Confirm we are now in sign-up mode
    await expect(page.getByText('Create a new account')).toBeVisible();
  });
});
