// spec: specs/agent-kanban.plan.md
// section: 3.12 Task detail — set priority

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Task detail — set priority', async ({ page }) => {
    // 1. Sign in, navigate to a board, and open a task's detail sheet
    await signUpAndGetBoard(page, `boardpriority_${Date.now()}@example.com`);

    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await titleInput.fill('Priority Task');
    await titleInput.press('Enter');
    await expect(page.getByText('Priority Task').first()).toBeVisible();
    await page.getByText('Priority Task').first().click();

    const sheet = page.locator('[data-slot="sheet-content"]');
    await expect(sheet).toBeVisible();

    // expect: A priority select trigger is present in the task header area
    // There are two select triggers: repo (first) and priority (second)
    const selectTriggers = sheet.locator('[data-slot="select-trigger"]');
    const priorityTrigger = selectTriggers.nth(1);
    await expect(priorityTrigger).toBeVisible();

    // 2. Open the priority dropdown and select 'urgent'
    await priorityTrigger.click();

    // The select popup opens - find the 'urgent' option
    const urgentOption = page.getByRole('option', { name: 'urgent' });
    await expect(urgentOption).toBeVisible();
    await urgentOption.click();

    // expect: The priority trigger now reflects the selected priority 'urgent'
    await expect(priorityTrigger).toContainText('urgent');
  });
});
