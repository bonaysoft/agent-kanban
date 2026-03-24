// spec: specs/agent-kanban.plan.md
// section: 3.2 Create a new task via the Todo column '+' button

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Create a new task via the Todo column + button', async ({ page }) => {
    // 1. Sign in and navigate to a board page
    await signUpAndGetBoard(page, `boardcreate_${Date.now()}@example.com`);

    // expect: The board is displayed with a '+ Task' button in the Todo column
    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await expect(addTaskButton).toBeVisible();

    // 2. Click the '+ Task' button in the Todo column
    await addTaskButton.click();

    // expect: An inline text input appears with focus set on it and placeholder text 'Task title...'
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await expect(titleInput).toBeVisible();
    await expect(titleInput).toBeFocused();

    // 3. Type 'My new task' in the input and press Enter
    await titleInput.fill('My new task');
    await titleInput.press('Enter');

    // expect: The input disappears
    await expect(titleInput).not.toBeVisible();

    // expect: A new task card titled 'My new task' appears in the Todo column
    await expect(page.getByText('My new task').first()).toBeVisible();

    // expect: The '+ Task' button reappears
    await expect(addTaskButton).toBeVisible();
  });
});
