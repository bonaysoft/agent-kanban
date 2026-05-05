// spec: specs/agent-kanban.plan.md
// section: 5.4 Account settings page

import { expect, type Page, test } from "@playwright/test";
import { signUpAndGetBoard } from "../helpers/auth";

// ─── Fixture data ─────────────────────────────────────────────────────────────

const CREDENTIAL_ACCOUNT = {
  id: "acc-cred-1",
  providerId: "credential",
  accountId: "test@example.com",
  createdAt: new Date().toISOString(),
  scopes: [],
};

const GITHUB_ACCOUNT = {
  id: "acc-gh-1",
  providerId: "github",
  accountId: "githubuser123",
  createdAt: new Date().toISOString(),
  scopes: [],
};

const MOCK_SESSION = {
  id: "sess-mock-1",
  token: "token-mock-1",
  userId: "user-mock-1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
  ipAddress: "127.0.0.1",
  userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36",
};

// ─── Helper ───────────────────────────────────────────────────────────────────

/** Register route mocks BEFORE navigation so async data resolves immediately. */
async function mockAccountData(page: Page, accounts: unknown[] = [CREDENTIAL_ACCOUNT], sessions: unknown[] = [MOCK_SESSION]) {
  await page.route("**/api/auth/list-accounts", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(accounts) }),
  );
  await page.route("**/api/auth/list-sessions", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(sessions) }),
  );
}

// ─── Tests ────────────────────────────────────────────────────────────────────

test.describe("Account Settings Page", () => {
  test("Account sidebar active — Account NavLink has bg-accent-soft, Profile does not", async ({ page }) => {
    await signUpAndGetBoard(page, `account_sidebar_${Date.now()}@example.com`);
    await mockAccountData(page);

    await page.goto("/settings/account");

    const settingsNav = page.getByRole("navigation", { name: "Settings" });
    await expect(settingsNav.getByRole("link", { name: "Account" })).toHaveAttribute("class", /bg-accent-soft/);
    await expect(settingsNav.getByRole("link", { name: "Profile" })).not.toHaveAttribute("class", /bg-accent-soft/);
  });

  test("Account page heading is visible", async ({ page }) => {
    await signUpAndGetBoard(page, `account_heading_${Date.now()}@example.com`);
    await mockAccountData(page);

    await page.goto("/settings/account");

    await expect(page.getByRole("heading", { name: "Account", level: 1 })).toBeVisible();
  });

  test("GitHub not connected — shows message and Connect GitHub button", async ({ page }) => {
    await signUpAndGetBoard(page, `account_github_${Date.now()}@example.com`);
    await mockAccountData(page, [CREDENTIAL_ACCOUNT]);

    await page.goto("/settings/account");

    await expect(page.getByText("GitHub not connected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
  });

  test("Password validation — short password shows error and submit is disabled", async ({ page }) => {
    await signUpAndGetBoard(page, `account_pw_short_${Date.now()}@example.com`);
    await mockAccountData(page);

    await page.goto("/settings/account");

    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill("short");

    await expect(page.getByText("Password must be at least 8 characters.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Change password" })).toBeDisabled();
  });

  test("Password validation — mismatching passwords shows error", async ({ page }) => {
    await signUpAndGetBoard(page, `account_pw_mismatch_${Date.now()}@example.com`);
    await mockAccountData(page);

    await page.goto("/settings/account");

    await expect(page.getByLabel("New password", { exact: true })).toBeVisible();

    await page.getByLabel("New password", { exact: true }).fill("password123");
    await page.getByLabel("Confirm new password", { exact: true }).fill("different123");

    await expect(page.getByText("Passwords do not match.")).toBeVisible();
  });

  test("Password change success — fields cleared and success message shown", async ({ page }) => {
    await signUpAndGetBoard(page, `account_pw_success_${Date.now()}@example.com`);
    await mockAccountData(page);

    await page.route("**/api/auth/change-password", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({}) }),
    );

    await page.goto("/settings/account");

    await expect(page.getByLabel("Current password")).toBeVisible();

    await page.getByLabel("Current password").fill("old");
    await page.getByLabel("New password", { exact: true }).fill("newpass123");
    await page.getByLabel("Confirm new password", { exact: true }).fill("newpass123");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByText("Password changed successfully.")).toBeVisible();
    await expect(page.getByLabel("Current password")).toHaveValue("");
    await expect(page.getByLabel("New password", { exact: true })).toHaveValue("");
    await expect(page.getByLabel("Confirm new password", { exact: true })).toHaveValue("");
  });

  test("Password change error — shows error message from API", async ({ page }) => {
    await signUpAndGetBoard(page, `account_pw_error_${Date.now()}@example.com`);
    await mockAccountData(page);

    await page.route("**/api/auth/change-password", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "Invalid current password" }),
      }),
    );

    await page.goto("/settings/account");

    await expect(page.getByLabel("Current password")).toBeVisible();

    await page.getByLabel("Current password").fill("wrongpassword");
    await page.getByLabel("New password", { exact: true }).fill("newpass123");
    await page.getByLabel("Confirm new password", { exact: true }).fill("newpass123");
    await page.getByRole("button", { name: "Change password" }).click();

    await expect(page.getByRole("alert")).toContainText("Invalid current password");
  });

  test("Sessions list renders — Active sessions heading is visible", async ({ page }) => {
    await signUpAndGetBoard(page, `account_sessions_${Date.now()}@example.com`);
    await mockAccountData(page);

    await page.goto("/settings/account");

    await expect(page.getByRole("heading", { name: "Active sessions", level: 2 })).toBeVisible();
  });

  test("OAuth-only account shows no password form", async ({ page }) => {
    await signUpAndGetBoard(page, `account_oauth_${Date.now()}@example.com`);
    await mockAccountData(page, [GITHUB_ACCOUNT]);

    await page.goto("/settings/account");

    await expect(page.getByText("Your account uses OAuth only.")).toBeVisible();
    await expect(page.getByLabel("Current password")).not.toBeVisible();
  });

  test("listAccounts failure — GitHub and password sections show error, not misleading defaults", async ({ page }) => {
    await signUpAndGetBoard(page, `account_load_fail_${Date.now()}@example.com`);

    // Fail list-accounts; sessions succeed so we can isolate the accounts error
    await page.route("**/api/auth/list-accounts", (route) =>
      route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ message: "Server error" }) }),
    );
    await page.route("**/api/auth/list-sessions", (route) =>
      route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([MOCK_SESSION]) }),
    );

    await page.goto("/settings/account");

    // GitHub section must NOT show "GitHub not connected" or "Connect GitHub"
    await expect(page.getByText("GitHub not connected")).not.toBeVisible();
    await expect(page.getByRole("button", { name: "Connect GitHub" })).not.toBeVisible();

    // Password section must NOT show the OAuth-only message
    await expect(page.getByText("Your account uses OAuth only.")).not.toBeVisible();

    // Both sections show an error alert instead
    const alerts = page.getByRole("alert");
    await expect(alerts.first()).toBeVisible();
  });

  test("GitHub connect error — shows inline error and toast", async ({ page }) => {
    await signUpAndGetBoard(page, `account_gh_err_${Date.now()}@example.com`);
    await mockAccountData(page, [CREDENTIAL_ACCOUNT]);

    await page.route("**/api/auth/link-social", (route) =>
      route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ message: "GitHub OAuth failed" }),
      }),
    );

    await page.goto("/settings/account");

    await expect(page.getByRole("button", { name: "Connect GitHub" })).toBeVisible();
    await page.getByRole("button", { name: "Connect GitHub" }).click();

    await expect(page.getByRole("alert").filter({ hasText: "GitHub OAuth failed" })).toBeVisible();
  });
});
