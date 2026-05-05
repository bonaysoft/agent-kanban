import { createHmac } from "node:crypto";
import { expect, test } from "@playwright/test";

const authSecret = "dev-secret-change-in-production-32ch";

test.describe("Authentication", () => {
  test("new email users verify through the verification page and get signed in", async ({ page }) => {
    const email = `verify-e2e-${Date.now()}@example.com`;
    const password = "validpassword123";

    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign up" }).click();

    await page.locator('input[placeholder="Name"]').fill("Verify E2E");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Sign Up" }).click();

    await expect(page.getByText("Verify your email")).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();

    await page.goto(`/auth/verify?token=${verificationToken(email)}`);
    await expect(page.getByText("Email verified")).toBeVisible();
    await page.waitForURL((url) => url.pathname !== "/auth/verify", { timeout: 5000 });

    const session = await page.evaluate(async () => {
      const res = await fetch("/api/auth/get-session", { credentials: "include" });
      return res.json();
    });

    expect(session.user.email).toBe(email);
    expect(session.user.emailVerified).toBe(true);
  });

  test("verified email users sign in to the app instead of the verification page", async ({ page }) => {
    const email = `verified-signin-e2e-${Date.now()}@example.com`;
    const password = "validpassword123";

    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.locator('input[placeholder="Name"]').fill("Verified Signin E2E");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Sign Up" }).click();
    await expect(page.getByText("Verify your email")).toBeVisible();

    await page.goto(`/auth/verify?token=${verificationToken(email)}`);
    await page.waitForURL((url) => url.pathname !== "/auth/verify", { timeout: 5000 });
    await page.context().clearCookies();

    await page.goto("/auth");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();

    await page.waitForURL((url) => url.pathname !== "/auth" && url.pathname !== "/auth/verify", { timeout: 5000 });
    expect(new URL(page.url()).pathname).toBe("/");
  });

  test("unverified email users sign in to the verification handoff instead of the app", async ({ page }) => {
    const email = `unverified-signin-e2e-${Date.now()}@example.com`;
    const password = "validpassword123";

    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign up" }).click();
    await page.locator('input[placeholder="Name"]').fill("Unverified Signin E2E");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Sign Up" }).click();
    await expect(page.getByText("Verify your email")).toBeVisible();
    await page.context().clearCookies();

    await page.goto("/auth");
    await page.locator('input[type="email"]').fill(email);
    await page.locator('input[type="password"]').fill(password);
    await page.getByRole("button", { name: "Sign In" }).click();

    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByText("Verify your email")).toBeVisible();
    await expect(page.getByText(email)).toBeVisible();
    await expect(page.getByText("We sent another verification link to your email.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Resend verification email" })).toBeVisible();
  });
});

function verificationToken(email: string): string {
  const now = Math.floor(Date.now() / 1000);
  const payload = { email, iat: now, exp: now + 60 * 60 };
  const encodedHeader = base64Url(JSON.stringify({ alg: "HS256" }));
  const encodedPayload = base64Url(JSON.stringify(payload));
  const signature = createHmac("sha256", authSecret).update(`${encodedHeader}.${encodedPayload}`).digest("base64url");

  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

function base64Url(value: string): string {
  return Buffer.from(value).toString("base64url");
}
