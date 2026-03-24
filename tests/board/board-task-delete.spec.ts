// spec: specs/agent-kanban.plan.md
// section: 3.11 Task detail — delete a task

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Task detail — delete a task', async ({ page }) => {
    // 1. Sign in, navigate to a board, and open the task detail sheet for a 'Todo' task with no agent assigned
    await signUpAndGetBoard(page, `boarddelete_${Date.now()}@example.com`);

    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await titleInput.fill('Task to Delete');
    await titleInput.press('Enter');
    await expect(page.getByText('Task to Delete').first()).toBeVisible();
    await page.getByText('Task to Delete').first().click();

    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();

    // expect: A 'Delete task' button is visible at the bottom of the details section
    const deleteButton = sheet.getByRole('button', { name: 'Delete task' });
    await expect(deleteButton).toBeVisible();

    // 2. Click 'Delete task'
    await deleteButton.click();

    // expect: The task detail sheet closes
    await expect(sheet).not.toBeVisible();

    // expect: The task card is removed from the board
    await expect(page.getByText('Task to Delete').first()).not.toBeVisible();

    // expect: The '+ Task' button is still present (board is restored)
    await expect(page.getByRole('button', { name: '+ Task' })).toBeVisible();
  });
});
