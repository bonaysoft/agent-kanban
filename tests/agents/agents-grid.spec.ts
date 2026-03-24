// spec: specs/agent-kanban.plan.md
// section: 7.2 Agents page renders agent cards in a grid

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Agents Page', () => {
  test('Agents page renders agent cards in a grid', async ({ page }) => {
    // 1. Sign in as a user with at least one agent and navigate to /agents
    await signUpAndGetBoard(page, `agents_grid_${Date.now()}@example.com`);
    await page.goto('/agents');

    // Wait for the agent card grid to load
    await page.getByText('Quality Goalkeeper').first().waitFor({ state: 'visible' });

    // expect: Agents are displayed in a 3-column card grid
    const agentCard = page.getByRole('link', { name: /Quality Goalkeeper/ });
    await expect(agentCard).toBeVisible();

    // expect: Each card shows the agent identicon (img), agent name, fingerprint badge, status indicator
    await expect(agentCard.getByRole('heading', { name: 'Quality Goalkeeper' })).toBeVisible();
    await expect(agentCard.getByText(/Offline|Online/)).toBeVisible();

    // expect: Stats strip with task count, token count, and cost
    await expect(agentCard.getByText(/tasks/)).toBeVisible();
    await expect(agentCard.getByText(/tok/)).toBeVisible();
    await expect(agentCard.getByText(/\$/)).toBeVisible();
  });
});
