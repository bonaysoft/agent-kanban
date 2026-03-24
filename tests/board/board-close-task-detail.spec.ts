// spec: specs/agent-kanban.plan.md
// section: 3.6 Close task detail sheet

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Close task detail sheet', async ({ page }) => {
    // 1. Sign in, navigate to a board, and click a task card to open the detail sheet
    await signUpAndGetBoard(page, `boardclose_${Date.now()}@example.com`);

    // Create and open a task
    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await titleInput.fill('Task to close');
    await titleInput.press('Enter');
    await expect(page.getByText('Task to close').first()).toBeVisible();
    await page.getByText('Task to close').first().click();

    // expect: Task detail sheet is open
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();

    // 2. Click the '✕' close button in the sheet header
    await sheet.getByRole('button', { name: '✕' }).click();

    // expect: The task detail sheet closes
    await expect(sheet).not.toBeVisible();

    // expect: The board view is restored without the sheet
    await expect(page.getByRole('button', { name: '+ Task' })).toBeVisible();
  });
});
