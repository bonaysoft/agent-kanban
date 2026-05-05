// spec: specs/agent-kanban.plan.md
// section: 5.3 Profile save updates session-backed header

import { expect, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

test.describe("Settings Profile", () => {
  test("saves display name and updates the header without reloading", async ({ page }) => {
    await signUpAndGetBoard(page, `settings_profile_save_${Date.now()}@example.com`, "Original User");
    await page.goto("/settings/profile");
    let savedName = "Original User";

    await page.route("**/api/auth/update-user", async (route) => {
      const body = JSON.parse(route.request().postData() || "{}") as { name: string };
      savedName = body.name;
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) });
    });
    await page.route("**/api/auth/get-session", async (route) => {
      if (savedName === "Original User") {
        await route.continue();
        return;
      }

      const res = await route.fetch();
      const session = await res.json();
      session.user.name = savedName;
      await route.fulfill({ response: res, json: session });
    });

    await page.evaluate(() => {
      (window as typeof window & { profileSaveMarker?: string }).profileSaveMarker = "still-here";
    });

    await page.getByLabel("Display name").fill("Updated Profile User");
    await page.getByRole("button", { name: "Save profile" }).click();

    await expect(page.getByText("Profile saved")).toBeVisible();
    await expect(page.getByRole("button", { name: "Save profile" })).toBeDisabled();
    await expect.poll(() => page.evaluate(() => (window as typeof window & { profileSaveMarker?: string }).profileSaveMarker)).toBe("still-here");

    const header = page.locator("header");
    await header.locator("button.rounded-full").click();

    const dropdown = page.locator('[data-slot="dropdown-menu-content"]');
    await expect(dropdown).toBeVisible();
    await expect(dropdown.getByText("Updated Profile User")).toBeVisible();
    await expect(dropdown.getByText("Original User")).not.toBeVisible();
  });
});
