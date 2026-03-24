// spec: specs/agent-kanban.plan.md
// section: 7.17 Agent detail — Sessions tab lists sessions or empty state

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Agents Page', () => {
  test('Agent detail — Sessions tab lists sessions or empty state', async ({ page }) => {
    // 1. Sign in, navigate to an agent detail page, and click the 'Sessions' tab
    await signUpAndGetBoard(page, `agent_sessions_${Date.now()}@example.com`);
    await page.goto('/agents');

    await page.getByText('Quality Goalkeeper').first().waitFor({ state: 'visible' });
    await page.getByRole('link', { name: /Quality Goalkeeper/ }).click();
    await expect(page).toHaveURL(/\/agents\/.+/);

    await page.getByText('← Agents').first().waitFor({ state: 'visible' });

    // Click the Sessions tab
    await page.getByRole('button', { name: 'Sessions' }).click();

    // expect: If no sessions exist, the text 'No sessions yet.' is displayed
    await expect(page.getByText('No sessions yet.')).toBeVisible();
  });
});
