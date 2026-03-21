import { betterAuth } from "better-auth";
import { bearer } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { Kysely } from "kysely";
import { D1Dialect } from "kysely-d1";
import type { Env } from "./types";

export function createAuth(env: Env) {
  return betterAuth({
    database: {
      db: new Kysely({ dialect: new D1Dialect({ database: env.DB }) }),
      type: "sqlite",
    },
    basePath: "/api/auth",
    baseURL: env.BETTER_AUTH_URL,
    secret: env.AUTH_SECRET,
    trustedOrigins: env.TRUSTED_ORIGINS ? env.TRUSTED_ORIGINS.split(",") : [],
    emailAndPassword: {
      enabled: true,
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
    plugins: [
      bearer(),
      apiKey({
        apiKeyPrefix: "ak",
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
