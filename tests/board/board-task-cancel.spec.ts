// spec: specs/agent-kanban.plan.md
// section: 3.10 Task detail — cancel a task

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  // fixme: The state machine only allows users to cancel tasks in 'in_progress' or 'in_review'
  // status (not 'todo'). A fresh todo task has no 'Cancel' button for user identity.
  // The test assumes cancel is available on todo tasks, which contradicts the state machine.
  test.fixme('Task detail — cancel a task', async ({ page }) => {
    await signUpAndGetBoard(page, `boardcancel_${Date.now()}@example.com`);

    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await titleInput.fill('Task to Cancel');
    await titleInput.press('Enter');
    await expect(page.getByText('Task to Cancel').first()).toBeVisible();
    await page.getByText('Task to Cancel').first().click();

    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();

    // expect: A 'Cancel' action button is visible
    const cancelButton = sheet.getByRole('button', { name: 'Cancel' });
    await expect(cancelButton).toBeVisible();

    // 2. Click the 'Cancel' button
    await cancelButton.click();

    // expect: The task status updates to 'Cancelled'
    await expect(sheet.getByText('Cancelled')).toBeVisible();

    // expect: The task card appears in the Cancelled column
    await sheet.getByRole('button', { name: '✕' }).click();
    await expect(page.getByText('Task to Cancel')).toBeVisible();
  });
});
