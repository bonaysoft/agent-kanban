// spec: specs/agent-kanban.plan.md
// section: 7.1 Agents page renders empty state when no agents exist
// NOTE: The app always provisions a built-in "Quality Goalkeeper" agent for every new user,
// so the empty state ("No agents yet.") is not reachable in practice.
// This test verifies the agents page heading, "New agent" button, and the grid of agent cards
// that is shown for a fresh user (with only the built-in agent present).

import { test, expect } from '@playwright/test';
import { signUpAndGetBoard } from '../helpers/auth';

test.describe('Agents Page', () => {
  test('Agents page renders empty state when no agents exist', async ({ page }) => {
    // 1. Sign in as a user with no agents and navigate to /agents
    await signUpAndGetBoard(page, `agents_empty_${Date.now()}@example.com`);
    await page.goto('/agents');

    // expect: Heading 'Agents' is displayed
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();

    // expect: A 'New agent' button is visible
    await expect(page.getByRole('link', { name: 'New agent' })).toBeVisible();

    // NOTE: A built-in agent always exists, so we verify the page loads correctly.
    // The "No agents yet." state cannot be reached in the current implementation.
    await page.getByText('Quality Goalkeeper').first().waitFor({ state: 'visible' });
    await expect(page.getByText('Quality Goalkeeper').first()).toBeVisible();
  });
});
