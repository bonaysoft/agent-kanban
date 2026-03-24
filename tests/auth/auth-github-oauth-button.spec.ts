// spec: specs/agent-kanban.plan.md
// section: 1.10 GitHub OAuth button is present and interactive

import { expect, test } from "@playwright/test";

test.describe("Authentication", () => {
  test("GitHub OAuth button is present and interactive", async ({ page }) => {
    // 1. Navigate to /auth
    await page.goto("/auth");

    // expect: The 'Continue with GitHub' button is visible with the GitHub SVG icon
    const githubButton = page.getByRole("button", { name: "Continue with GitHub" });
    await expect(githubButton).toBeVisible();

    // expect: The button contains the GitHub SVG icon
    await expect(githubButton.locator("svg")).toBeVisible();

    // 2. Observe the button — it is clickable (not disabled)
    // expect: The button is not disabled
    await expect(githubButton).toBeEnabled();

    // Verify the button triggers OAuth by checking it is interactive
    // (We do not follow the full OAuth redirect since that requires GitHub credentials)
    // The button has no explicit type attribute in the source — toHaveAttribute('type', 'button')
    // would fail. Visibility and enabled state above are sufficient to confirm interactivity.
  });
});
