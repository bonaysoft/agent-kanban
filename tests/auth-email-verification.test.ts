// @vitest-environment node

import { Miniflare } from "miniflare";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createTestEnv, setupMiniflare } from "./helpers/db";

const env = createTestEnv();
const remoteEnv = createTestEnv();
let mf: Miniflare;
let sentEmails: any[];

beforeAll(async () => {
  ({ mf, db: env.DB } = await setupMiniflare());
  remoteEnv.DB = env.DB;
  remoteEnv.ALLOWED_HOSTS = "agent-kanban.dev";
  sentEmails = [];
  remoteEnv.EMAIL = {
    send: async (message: any) => {
      sentEmails.push(message);
      return { messageId: `message-${sentEmails.length}` };
    },
  } as SendEmail;
});

afterAll(async () => {
  await mf.dispose();
});

describe("email verification auth", () => {
  it("sends a verification email on sign-up and does not create a session", async () => {
    const { createAuth } = await import("../apps/web/server/betterAuth");
    const auth = createAuth(remoteEnv);

    const result = await auth.api.signUpEmail({
      body: { name: "Verify User", email: "verify-user@test.com", password: "password-123", callbackURL: "/" },
    });

    expect(result.token).toBeNull();
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0].to).toBe("verify-user@test.com");
    expect(sentEmails[0].from).toEqual({ email: "noreply@agent-kanban.dev", name: "Agent Kanban" });
    expect(sentEmails[0].text).toContain("/auth/verify?token=");
  });

  it("rejects unverified email sign-in and sends another verification email", async () => {
    const { createAuth } = await import("../apps/web/server/betterAuth");
    const auth = createAuth(remoteEnv);
    const before = sentEmails.length;

    await expect(
      auth.api.signInEmail({
        body: { email: "verify-user@test.com", password: "password-123", callbackURL: "/" },
      }),
    ).rejects.toMatchObject({ status: "FORBIDDEN" });

    expect(sentEmails).toHaveLength(before + 1);
    expect(sentEmails.at(-1).to).toBe("verify-user@test.com");
  });

  it("prints the verification link locally instead of sending email", async () => {
    const { createAuth } = await import("../apps/web/server/betterAuth");
    const auth = createAuth(env);
    let sendCount = 0;
    env.EMAIL = {
      send: async () => {
        sendCount += 1;
        return { messageId: "unexpected" };
      },
    } as SendEmail;

    const result = await auth.api.signUpEmail({
      body: { name: "Local Verify User", email: "local-verify-user@test.com", password: "password-123", callbackURL: "/" },
    });

    expect(result.token).toBeNull();
    expect(sendCount).toBe(0);
  });
});
