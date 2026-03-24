// spec: specs/agent-kanban.plan.md
// section: 3.4 Cancel task creation by blurring with empty input

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Board Page', () => {
  test('Cancel task creation by blurring with empty input', async ({ page }) => {
    // 1. Sign in and navigate to a board page. Click '+ Task' to open the inline input.
    await signUpAndGetBoard(page, `boardblur_${Date.now()}@example.com`);

    const addTaskButton = page.getByRole('button', { name: '+ Task' });
    await addTaskButton.click();

    // expect: Input is visible
    const titleInput = page.locator('input[placeholder="Task title..."]');
    await expect(titleInput).toBeVisible();

    // 2. Click somewhere else on the page (blur the input) without typing
    await page.locator('header').click();

    // expect: The input is hidden (onBlur cancels if the title is empty)
    await expect(titleInput).not.toBeVisible();

    // expect: The '+ Task' button reappears
    await expect(addTaskButton).toBeVisible();

    // expect: No task is created
  });
});
