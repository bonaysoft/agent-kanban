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

export async function refreshAuthToken(): Promise<string | null> {
  const res = await fetch("/api/auth/get-session", { credentials: "include" });
  if (!res.ok) {
    clearAuthToken();
    return null;
  }

  const data = (await res.json()) as { session?: { token?: string } } | null;
  const token = data?.session?.token ?? null;
  if (!token) {
    clearAuthToken();
    return null;
  }
  setAuthToken(token);
  return token;
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
