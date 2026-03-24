// spec: specs/agent-kanban.plan.md
// section: 1.7 Sign-up form validation — empty name field

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('Sign-up form validation — empty name field', async ({ page }) => {
    // 1. Navigate to /auth and switch to sign-up mode
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign up' }).click();

    // expect: Sign-up form is displayed
    await expect(page.getByText('Create a new account')).toBeVisible();

    // 2. Leave Name blank, enter 'test@example.com' in Email and 'validpassword' in Password
    await page.locator('input[type="email"]').fill('test@example.com');
    await page.locator('input[type="password"]').fill('validpassword');

    // Click 'Sign Up'
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // expect: The form does not submit because the Name field is required
    // expect: Browser native validation prevents the action
    await expect(page).toHaveURL(/\/auth/);
    await expect(page.getByText('Create a new account')).toBeVisible();
  });
});
