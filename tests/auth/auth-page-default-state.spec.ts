// spec: specs/agent-kanban.plan.md
// section: 1.1 Auth page renders sign-in form by default

import { test, expect } from '@playwright/test';

test.describe('Authentication', () => {
  test('Auth page renders sign-in form by default', async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto('/auth');

    // expect: The page title 'Agent Kanban' is visible with 'Kanban' in accent color
    await expect(page.getByRole('heading', { name: /Agent\s+Kanban/i })).toBeVisible();
    await expect(page.locator('h1 span.text-accent')).toHaveText('Kanban');

    // expect: The subtitle 'Sign in to your account' is visible
    await expect(page.getByText('Sign in to your account')).toBeVisible();

    // expect: An email input field is present
    await expect(page.locator('input[type="email"]')).toBeVisible();

    // expect: A password input field is present
    await expect(page.locator('input[type="password"]')).toBeVisible();

    // expect: A 'Sign In' submit button is visible
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();

    // expect: A 'Continue with GitHub' button is visible
    await expect(page.getByRole('button', { name: 'Continue with GitHub' })).toBeVisible();

    // expect: A 'Sign up' toggle link is visible
    await expect(page.getByRole('button', { name: 'Sign up' })).toBeVisible();

    // expect: The Name field is NOT present (sign-up only field)
    await expect(page.locator('input[placeholder="Name"]')).not.toBeVisible();
  });
});
