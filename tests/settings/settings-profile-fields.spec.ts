// spec: specs/agent-kanban.plan.md
// section: 5.2 Profile settings fields

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Profile", () => {
  test("shows readonly email and email verification state", async ({ page }) => {
    const email = `settings_profile_fields_${Date.now()}@example.com`;
    await signUpAndGetBoard(page, email);

    await page.goto("/settings/profile");

    const emailInput = page.getByLabel("Email");
    await expect(emailInput).toHaveValue(email);
    await expect(emailInput).not.toBeEditable();
    await expect(page.getByText(/^(Verified|Unverified)$/)).toBeVisible();
  });
});
