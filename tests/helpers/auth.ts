import { Page, expect } from '@playwright/test';

/**
 * Signs up a new user and completes the full onboarding flow (3 steps),
 * then navigates to the actual board page at /boards/:id.
 *
 * Onboarding steps:
 *   0 - Create Board (board name input + "Create Board" button)
 *   1 - Create first task ("First task" input + "Create Task" button)
 *   2 - AddMachineSteps (shows API key + "Waiting for connection..." - no skip)
 *
 * After step 1 completes, the board exists. We fetch the board list via the API
 * and navigate directly instead of waiting for a machine to connect.
 */
export async function signUpAndGetBoard(
  page: Page,
  email: string,
  name = 'Test User',
): Promise<void> {
  await page.goto('/auth');
  await page.getByRole('button', { name: 'Sign up' }).click();
  await page.locator('input[placeholder="Name"]').fill(name);
  await page.locator('input[type="email"]').fill(email);
  await page.locator('input[type="password"]').fill('password123');
  await page.getByRole('button', { name: 'Sign Up' }).click();

  // Wait to land on the onboarding page
  await page.waitForURL(/\/boards\/_new/);

  // Step 0: create the board
  await page.getByRole('button', { name: 'Create Board' }).click();

  // Step 1: create the first task
  await expect(page.getByRole('button', { name: 'Create Task' })).toBeVisible();
  await page.getByRole('button', { name: 'Create Task' }).click();

  // Step 2 is now shown (AddMachineSteps / "Waiting for connection").
  // The board and task already exist in the DB — fetch the board ID and navigate directly.
  await expect(page.getByText('Waiting for connection...')).toBeVisible();

  const boardId = await page.evaluate(async () => {
    const token = localStorage.getItem('auth-token');
    const res = await fetch('/api/boards', {
      headers: { Authorization: `Bearer ${token}` },
    });
    const boards = await res.json() as { id: string }[];
    return boards[0]?.id ?? null;
  });

  if (!boardId) throw new Error('No board found after onboarding');

  await page.goto(`/boards/${boardId}`);
  await expect(page).toHaveURL(/\/boards\/.+/);
  // Wait for the board to be fully loaded (column grid visible)
  await expect(page.locator('.hidden.md\\:grid')).toBeVisible();
}
