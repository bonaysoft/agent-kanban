// spec: specs/agent-kanban.plan.md
// section: 5.8 Board item — delete with two-step confirmation

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Page", () => {
  test("Board item — delete with two-step confirmation", async ({ page }) => {
    // 1. Sign in, navigate to /settings, and expand a board item
    await signUpAndGetBoard(page, `settings_delete_${Date.now()}@example.com`);
    await page.goto("/settings");
    await page.getByText("My BoardOpen").click();

    // expect: A 'Delete' button is visible in the expanded area
    const deleteButton = page.getByRole("button", { name: "Delete" });
    await expect(deleteButton).toBeVisible();

    // 2. Click the 'Delete' button
    await deleteButton.click();

    // expect: The delete button is replaced by 'Delete?', 'Yes', and 'No' inline confirmation options
    await expect(page.getByText("Delete?")).toBeVisible();
    await expect(page.getByRole("button", { name: "Yes" })).toBeVisible();
    await expect(page.getByRole("button", { name: "No" })).toBeVisible();
    await expect(deleteButton).not.toBeVisible();

    // 3. Click 'No'
    await page.getByRole("button", { name: "No" }).click();

    // expect: The confirmation is dismissed and the 'Delete' button is shown again
    await expect(page.getByRole("button", { name: "Delete" })).toBeVisible();
    await expect(page.getByText("Delete?")).not.toBeVisible();

    // 4. Click 'Delete' again, then click 'Yes'
    await page.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("button", { name: "Yes" }).click();

    // expect: The board is deleted
    // expect: The board item disappears from the list
    await expect(page.getByText("My Board")).not.toBeVisible();
  });
});
