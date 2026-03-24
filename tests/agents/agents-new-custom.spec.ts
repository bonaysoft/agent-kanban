// spec: specs/agent-kanban.plan.md
// section: 7.5 Agent creation — choose 'Custom' path goes to form

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Agents Page", () => {
  test("Agent creation — choose 'Custom' path goes to form", async ({ page }) => {
    // 1. Sign in and navigate to /agents/new
    await signUpAndGetBoard(page, `agents_custom_${Date.now()}@example.com`);
    await page.goto("/agents/new");

    // expect: The 'Choose path' step is displayed with 'Recruit' and 'Custom' cards
    await expect(page.getByRole("button", { name: /Recruit/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Custom/ })).toBeVisible();

    // 2. Click the 'Custom' card
    await page.getByRole("button", { name: "Custom Build your own from" }).click();

    // expect: The form step is displayed with the heading 'Create agent'
    await expect(page.getByRole("heading", { name: "Create agent" })).toBeVisible();

    // expect: Identity fieldset with Name, Role, Bio, Soul inputs is visible
    await expect(page.getByRole("group", { name: "Identity" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Name" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Role" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Bio" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Soul" })).toBeVisible();

    // expect: Runtime fieldset with Runtime dropdown and Model input is visible
    await expect(page.getByRole("group", { name: "Runtime" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Model" })).toBeVisible();

    // expect: Workflow fieldset with 'Handoff to' and 'Skills' fields is visible
    await expect(page.getByRole("group", { name: "Workflow" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Type a skill and press Enter" })).toBeVisible();

    // expect: A live preview card is shown on the right side
    await expect(page.getByText("Preview")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Agent", exact: true })).toBeVisible();
  });
});
