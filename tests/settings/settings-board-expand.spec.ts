// spec: specs/agent-kanban.plan.md
// section: 5.5 Board item — expand to edit details

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Board item — expand to edit details", async ({ page }) => {
    // 1. Sign in and navigate to /settings. Verify at least one board is listed.
    await signUpAndGetBoard(page, `settings_expand_${Date.now()}@example.com`);
    await page.goto("/settings");

    // expect: Board items are in collapsed state by default, showing only the board name and an 'Open' link
    const boardRow = page.getByText("My BoardOpen");
    await expect(boardRow).toBeVisible();
    await expect(page.getByRole("button", { name: "Open" })).toBeVisible();

    // The expanded content (Name input, Description textarea) should not be visible yet
    await expect(page.locator("input")).not.toBeVisible();

    // 2. Click a board item row
    await boardRow.click();

    // expect: The board expands showing a Name input, a Description textarea, and a Delete button
    await expect(page.locator("input")).toBeVisible();
    await expect(page.getByPlaceholder("What is this board for?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
  });
});
