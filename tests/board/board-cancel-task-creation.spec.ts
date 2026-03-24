// spec: specs/agent-kanban.plan.md
// section: 3.3 Cancel task creation by pressing Escape

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Cancel task creation by pressing Escape', async ({ page }) => {
    // 1. Sign in and navigate to a board page
    await signUpAndGetBoard(page, `boardesc_${Date.now()}@example.com`);

    // 2. Click '+ Task' in the Todo column to open the inline input
    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();

    // expect: Input field is visible
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await expect(titleInput).toBeVisible();

    // 3. Press the Escape key without typing anything
    await titleInput.press('Escape');

    // expect: The input field is dismissed
    await expect(titleInput).not.toBeVisible();

    // expect: No new task is created
    // expect: The '+ Task' button reappears
    await expect(addTaskButton).toBeVisible();
  });
});
