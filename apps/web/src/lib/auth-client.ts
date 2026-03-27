import { agentAuthClient } from "@better-auth/agent-auth/client";
import { apiKeyClient } from "@better-auth/api-key/client";
import { adminClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

const TOKEN_KEY = "auth-token";

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setAuthToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearAuthToken() {
  localStorage.removeItem(TOKEN_KEY);
}

export const authClient = createAuthClient({
  plugins: [agentAuthClient(), apiKeyClient(), adminClient()],
  fetchOptions: {
    auth: {
      type: "Bearer",
      token: () => getAuthToken() || "",
    },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) {
        setAuthToken(token);
      }
    },
  },
});

export const { useSession, signIn, signUp, signOut } = authClient;
