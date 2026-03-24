// spec: specs/agent-kanban.plan.md
// section: 6.5 Closing Add Machine dialog before connecting revokes the API key

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Machines Page", () => {
  test("Closing Add Machine dialog before connecting revokes the API key", async ({ page }) => {
    // 1. Sign in, open the Add Machine dialog, click 'Your Computer' to generate an API key
    await signUpAndGetBoard(page, `machines_cancel_${Date.now()}@example.com`);
    await page.goto("/machines");
    await expect(page.getByText("No machines registered.")).toBeVisible();

    await page.getByRole("button", { name: "Add Machine" }).first().click();

    const dialog = page.locator('[data-slot="dialog-content"]');
    await expect(dialog).toBeVisible();

    // Click 'Your Computer' to generate an API key
    await dialog.getByRole("button", { name: /Your Computer/ }).click();

    // expect: The dialog shows the AddMachineSteps with an API key displayed
    await expect(dialog.getByText("Waiting for connection...")).toBeVisible();

    // The API key command should be shown (contains --api-key)
    await expect(dialog.getByText(/--api-key/)).toBeVisible();

    // 2. Close the dialog by pressing Escape before the machine connects
    await page.keyboard.press("Escape");

    // expect: The dialog closes
    await expect(dialog).not.toBeVisible();

    // expect: The machines list does not show a new machine
    await expect(page.getByText("No machines registered.")).toBeVisible();
  });
});
