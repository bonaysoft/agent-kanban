// spec: specs/agent-kanban.plan.md
// section: 3.8 Task detail — edit task title inline

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Task detail — edit task title inline', async ({ page }) => {
    const originalTitle = 'Original Task Title';
    const updatedTitle = 'Updated task title';

    // 1. Sign in, navigate to a board, and open the task detail sheet for a todo task
    await signUpAndGetBoard(page, `boardedittitle_${Date.now()}@example.com`);

    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await titleInput.fill(originalTitle);
    await titleInput.press('Enter');
    await expect(page.getByText(originalTitle).first()).toBeVisible();
    await page.getByText(originalTitle).first().click();

    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();

    // expect: Task title is displayed as editable text (as a span)
    const titleSpan = sheet.locator('span.text-lg.font-semibold');
    await expect(titleSpan).toHaveText(originalTitle);

    // 2. Click on the task title to activate the inline editor
    await titleSpan.click();

    // The EditableText component shows an Input on click
    const titleEditInput = sheet.locator('[data-slot="input"]').first();
    await expect(titleEditInput).toBeVisible();

    // Clear the current title, type new title, and save by pressing Enter
    await titleEditInput.clear();
    await titleEditInput.fill(updatedTitle);
    await titleEditInput.press('Enter');

    // expect: The title in the sheet updates to 'Updated task title'
    await expect(sheet.locator('span.text-lg.font-semibold')).toHaveText(updatedTitle);

    // expect: The corresponding task card in the board column also shows the updated title
    await sheet.getByRole('button', { name: '✕' }).click();
    await expect(page.getByText(updatedTitle).first()).toBeVisible();
  });
});
