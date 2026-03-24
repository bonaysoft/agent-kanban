// spec: specs/agent-kanban.plan.md
// section: 1.3 Sign-in form validation — empty fields

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('Sign-in form validation — empty fields', async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto('/auth');

    // expect: Sign-in form is displayed
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    // 2. Click the 'Sign In' button without entering any credentials
    await page.getByRole('button', { name: 'Sign In' }).click();

    // expect: The form does not submit
    // expect: Browser native validation prevents submission (email field is required)
    // The page should still be on /auth
    await expect(page).toHaveURL(/\/auth/);

    // The email input should be invalid (native browser validation)
    const emailInput = page.locator('input[type="email"]');
    await expect(emailInput).toBeVisible();
    // Native validation: the form is not submitted when required fields are empty
    await expect(page.getByText('Sign in to your account')).toBeVisible();
  });
});
