// spec: specs/agent-kanban.plan.md
// section: 3.16 Onboarding flow — new user with no boards

import { test, expect } from '@playwright/test';

test.describe('Board Page', () => {
  test('Onboarding flow — new user with no boards', async ({ page }) => {
    // 1. Sign in as a user who has no boards, then navigate to /boards/_new or to '/'
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.locator('input[placeholder="Name"]').fill('New User');
    await page.locator('input[type="email"]').fill(`onboarding_${Date.now()}@example.com`);
    await page.locator('input[type="password"]').fill('password123');
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // After sign-up of a new user, they are redirected to onboarding
    await page.waitForURL(/\/boards\/_new/);

    // expect: The Onboarding component is shown (not the board)
    // expect: A centered card displays 'Agent Kanban' heading and 'Your AI workforce starts here.'
    await expect(page.getByRole('heading', { name: 'Agent Kanban' })).toBeVisible();
    await expect(page.getByText('Your AI workforce starts here.')).toBeVisible();

    // expect: A 'Board name' input pre-filled with 'My Board' is shown
    const createBoardBtn = page.getByRole('button', { name: 'Create Board' });
    await expect(createBoardBtn).toBeVisible();

    // The board name input is the only textbox visible on this step
    const boardNameInput = page.getByRole('textbox');
    await expect(boardNameInput).toBeVisible();
    await expect(boardNameInput).toHaveValue('My Board');

    // 2. Clear the board name input and type 'Sprint 1', then click 'Create Board'
    await boardNameInput.clear();
    await boardNameInput.fill('Sprint 1');
    await createBoardBtn.click();

    // expect: The stepper advances to step 2
    // expect: A 'First task' input pre-filled with 'First task' appears
    const createTaskBtn = page.getByRole('button', { name: 'Create Task' });
    await expect(createTaskBtn).toBeVisible();

    const taskInput = page.getByRole('textbox');
    await expect(taskInput).toBeVisible();
    await expect(taskInput).toHaveValue('First task');

    // 3. Change the task title to 'Setup CI pipeline' and click 'Create Task'
    await taskInput.clear();
    await taskInput.fill('Setup CI pipeline');
    await createTaskBtn.click();

    // expect: The stepper advances to step 3
    // expect: The AddMachineSteps component is shown with installation instructions and an API key
    await expect(page.getByText(/npx|ak start|install/i)).toBeVisible();
  });
});
