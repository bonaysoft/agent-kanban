// spec: specs/agent-kanban.plan.md
// section: 4.10 Agents nav link is highlighted when on agents page

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Header and Navigation', () => {
  test('Agents nav link is highlighted when on agents page', async ({ page }) => {
    // 1. Sign in and navigate to /agents
    await signUpAndGetBoard(page, `headernavlink_${Date.now()}@example.com`);
    await page.goto('/agents');

    const header = page.locator('header');

    // expect: The 'Agents' nav link in the header is highlighted with accent color and accent-soft background
    const agentsLink = header.getByRole('link', { name: 'Agents' });
    await expect(agentsLink).toBeVisible();
    await expect(agentsLink).toHaveClass(/text-accent/);
    await expect(agentsLink).toHaveClass(/bg-accent-soft/);

    // expect: The 'Machines' nav link is in the default tertiary color
    const machinesLink = header.getByRole('link', { name: 'Machines' });
    await expect(machinesLink).toBeVisible();
    await expect(machinesLink).toHaveClass(/text-content-tertiary/);
    await expect(machinesLink).not.toHaveClass(/text-accent/);
  });
});
