// spec: specs/agent-kanban.plan.md
// section: 7.12 Agent detail page renders identity hero

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Agents Page', () => {
  test('Agent detail page renders identity hero', async ({ page }) => {
    // 1. Sign in and navigate to an agent's detail page at /agents/:id
    await signUpAndGetBoard(page, `agent_detail_${Date.now()}@example.com`);
    await page.goto('/agents');

    await page.getByText('Quality Goalkeeper').first().waitFor({ state: 'visible' });

    // Navigate to the agent detail page via card click
    await page.getByRole('link', { name: /Quality Goalkeeper/ }).click();
    await expect(page).toHaveURL(/\/agents\/.+/);

    await page.getByText('← Agents').first().waitFor({ state: 'visible' });

    // expect: A '← Agents' back link is visible
    await expect(page.getByRole('link', { name: '← Agents' })).toBeVisible();

    // expect: The identity hero card shows the agent name
    await expect(page.getByRole('heading', { name: 'Quality Goalkeeper' })).toBeVisible();

    // expect: Bio is visible
    await expect(page.getByText('Establishes quality standards')).toBeVisible();

    // expect: Metadata (runtime, model, created time) is visible
    await expect(page.getByText('claude-code')).toBeVisible();
    await expect(page.getByText('claude-opus-4-6')).toBeVisible();
    await expect(page.getByText(/Created/)).toBeVisible();

    // expect: A telemetry strip shows TASKS, INPUT, OUTPUT, CACHE, COST stats
    await expect(page.getByText('TASKS', { exact: true })).toBeVisible();
    await expect(page.getByText('INPUT', { exact: true })).toBeVisible();
    await expect(page.getByText('OUTPUT', { exact: true })).toBeVisible();
    await expect(page.getByText('CACHE', { exact: true })).toBeVisible();
    await expect(page.getByText('COST', { exact: true })).toBeVisible();

    // expect: Tabs for 'Mission', 'Activity', and 'Sessions' are displayed below the hero card
    await expect(page.getByRole('button', { name: 'Mission' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Activity' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sessions' })).toBeVisible();
  });
});
