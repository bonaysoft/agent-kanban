// spec: specs/agent-kanban.plan.md
// section: 5.7 Board item — save button hidden when no changes

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Settings Page', () => {
  test('Board item — save button hidden when no changes', async ({ page }) => {
    // 1. Sign in, navigate to /settings, and expand a board item
    await signUpAndGetBoard(page, `settings_nochanges_${Date.now()}@example.com`);
    await page.goto('/settings');
    await page.getByText('My BoardOpen').click();

    // expect: No 'Save' button is visible initially because no changes have been made
    const saveButton = page.getByRole('button', { name: 'Save' });
    await expect(saveButton).not.toBeVisible();

    // 2. Change the name field, then revert it back to the original name
    const nameInput = page.locator('input');
    await nameInput.click();
    await page.keyboard.press('End');
    await page.keyboard.type('X');

    // Save button should appear
    await expect(saveButton).toBeVisible();

    // Revert: delete the 'X' we typed
    await page.keyboard.press('Backspace');

    // expect: The 'Save' button disappears again because hasChanges returns to false
    await expect(saveButton).not.toBeVisible();
  });
});
