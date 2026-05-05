import { useEffect, useMemo, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { refreshAuthToken, setAuthToken } from "../lib/auth-client";

type VerifyState = "verifying" | "success" | "error";

export function AuthVerifyPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const params = useMemo(() => new URLSearchParams(location.search), [location.search]);
  const token = params.get("token");
  const urlError = params.get("error");
  const [state, setState] = useState<VerifyState>(urlError ? "error" : "verifying");
  const [error, setError] = useState<string | null>(urlError);

  useEffect(() => {
    if (urlError) {
      setError(urlError);
      setState("error");
      return;
    }
    if (!token) {
      setError("Missing verification token");
      setState("error");
      return;
    }

    verifyEmail(token)
      .then(async () => {
        setState("success");
        const refreshed = await refreshAuthToken();
        window.setTimeout(() => {
          navigate(refreshed ? "/" : "/auth", { replace: true });
        }, 900);
      })
      .catch((err) => {
        setError(err instanceof Error ? err.message : "Email verification failed");
        setState("error");
      });
  }, [navigate, token, urlError]);

  const failed = state === "error";

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-primary">
      <div className="w-full max-w-sm p-8 space-y-6 text-center">
        <div>
          <h1 className="text-xl font-bold tracking-tight text-content-primary">
            Agent <span className="text-accent">Kanban</span>
          </h1>
          <p className="mt-2 text-sm text-content-secondary">
            {state === "verifying" && "Verifying your email"}
            {state === "success" && "Email verified"}
            {failed && "Email verification failed"}
          </p>
        </div>

        <div className="rounded-lg border border-border bg-surface-secondary p-4 text-left">
          {failed ? (
            <p className="text-sm text-content-secondary">{verificationErrorMessage(error)}</p>
          ) : state === "success" ? (
            <p className="text-sm text-content-secondary">Your email is verified. Signing you in...</p>
          ) : (
            <p className="text-sm text-content-secondary">Checking your verification link...</p>
          )}
        </div>

        {failed && (
          <Link
            to="/auth"
            className="block w-full bg-accent text-surface-primary font-semibold text-sm py-2 rounded-lg hover:opacity-90 transition-opacity"
          >
            Back to sign in
          </Link>
        )}
      </div>
    </div>
  );
}

async function verifyEmail(token: string): Promise<void> {
  const res = await fetch(`/api/auth/verify-email?token=${encodeURIComponent(token)}`, {
    credentials: "include",
    redirect: "manual",
  });

  const authToken = res.headers.get("set-auth-token");
  if (authToken) setAuthToken(authToken);
  if (res.status >= 200 && res.status < 400) return;

  const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
  throw new Error(body?.message || body?.code || "Email verification failed");
}

function verificationErrorMessage(error: string | null): string {
  if (error === "TOKEN_EXPIRED") return "The verification link has expired. Return to sign in and request a new link.";
  if (error === "INVALID_TOKEN") return "The verification link is invalid. Return to sign in and request a new link.";
  return error || "The verification link could not be verified. Return to sign in and request a new link.";
}
