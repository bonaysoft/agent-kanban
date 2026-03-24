// spec: specs/agent-kanban.plan.md
// section: 4.6 Sign out via avatar dropdown

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Header and Navigation', () => {
  test('Sign out via avatar dropdown', async ({ page }) => {
    // 1. Sign in and navigate to any page
    await signUpAndGetBoard(page, `headersignout_${Date.now()}@example.com`);

    const header = page.locator('header');

    // Click the avatar button
    const avatarButton = header.locator('button.rounded-full');
    await avatarButton.click();

    const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdown).toBeVisible();

    // Click 'Sign out'
    await dropdown.getByText('Sign out').click();

    // expect: The user is signed out
    // expect: The browser navigates to /auth
    await expect(page).toHaveURL(/\/auth/);

    // expect: The sign-in form is displayed
    await expect(page.getByText('Sign in to your account')).toBeVisible();
  });
});
