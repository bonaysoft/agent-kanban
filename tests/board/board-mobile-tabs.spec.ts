// spec: specs/agent-kanban.plan.md
// section: 3.15 Mobile: board renders as single-column with tab switcher

import { test, expect } from '@playwright/test';

test.describe('Board Page', () => {
  test('Mobile: board renders as single-column with tab switcher', async ({ browser }) => {
    // 1. Sign in and navigate to a board page with the viewport set to a mobile width (375px wide)
    const context = await browser.newContext({
      viewport: { width: 375, height: 812 },
    });
    const page = await context.newPage();

    // Sign up and complete onboarding
    await page.goto('/auth');
    await page.getByRole('button', { name: 'Sign up' }).click();
    await page.locator('input[placeholder="Name"]').fill('Mobile Tester');
    await page.locator('input[type="email"]').fill(`boardmobile_${Date.now()}@example.com`);
    await page.locator('input[type="password"]').fill('password123');
    await page.getByRole('button', { name: 'Sign Up' }).click();

    // Wait for onboarding
    await page.waitForURL(/\/boards\/_new/);

    // Step 0: create board
    await page.getByRole('button', { name: 'Create Board' }).click();

    // Step 1: create first task
    await expect(page.getByRole('button', { name: 'Create Task' })).toBeVisible();
    await page.getByRole('button', { name: 'Create Task' }).click();

    // Step 2 shown - fetch board ID and navigate
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

    // expect: The 5-column desktop grid is hidden on mobile
    const desktopGrid = page.locator('.hidden.md\\:grid');
    await expect(desktopGrid).not.toBeVisible();

    // expect: A horizontal tab bar shows the 5 column names with task counts
    const mobileTabBar = page.locator('.flex.md\\:hidden.border-b');
    await expect(mobileTabBar).toBeVisible();

    // expect: Only the first column (Todo) is shown in the content area by default
    // The first tab should be highlighted with accent color
    const todoTab = mobileTabBar.getByText(/Todo/);
    await expect(todoTab).toBeVisible();

    // 2. Click the 'In Progress' tab
    await mobileTabBar.getByText(/In Progress/).click();

    // expect: The 'In Progress' tab is highlighted with an accent underline
    const inProgressTab = mobileTabBar.getByText(/In Progress/);
    await expect(inProgressTab).toHaveClass(/text-accent/);

    await context.close();
  });
});
