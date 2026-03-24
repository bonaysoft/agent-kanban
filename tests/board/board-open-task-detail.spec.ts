// spec: specs/agent-kanban.plan.md
// section: 3.5 Click a task card to open the task detail sheet

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Click a task card to open the task detail sheet', async ({ page }) => {
    // 1. Sign in and navigate to a board with at least one task
    await signUpAndGetBoard(page, `boarddetail_${Date.now()}@example.com`);

    // Create a task to click on
    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await titleInput.fill('Test Task for Detail');
    await titleInput.press('Enter');
    await expect(page.getByText('Test Task for Detail').first()).toBeVisible();

    // expect: Task cards are visible in the board columns
    const taskCard = page.getByText('Test Task for Detail').first();
    await expect(taskCard).toBeVisible();

    // 2. Click on any task card
    await taskCard.click();

    // expect: A side-sheet slides in from the right
    // The sheet is identified by the SheetContent
    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();

    // expect: The sheet displays the task title (visible span, not the sr-only heading)
    await expect(sheet.locator('span').filter({ hasText: 'Test Task for Detail' })).toBeVisible();

    // expect: The sheet shows Status, Assigned to, Duration fields
    await expect(sheet.getByText('Status')).toBeVisible();
    await expect(sheet.getByText('Assigned to')).toBeVisible();
    await expect(sheet.getByText('Duration')).toBeVisible();

    // expect: A Description editable area is present
    await expect(sheet.getByText('Description', { exact: true })).toBeVisible();

    // expect: An Activity log section is present
    await expect(sheet.getByText('Activity')).toBeVisible();
  });
});
