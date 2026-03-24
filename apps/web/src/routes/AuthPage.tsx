import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient, setAuthToken, signIn, signUp } from "../lib/auth-client";

function GitHubIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
      <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
    </svg>
  );
}

export function AuthPage() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const onSuccess = (ctx: any) => {
      const token = ctx.response.headers.get("set-auth-token");
      if (token) setAuthToken(token);
    };

    if (mode === "signin") {
      const { error } = await signIn.email({ email, password }, { onSuccess });
      if (error) {
        setError(error.message || "Sign in failed");
        setLoading(false);
        return;
      }
    } else {
      const { error } = await signUp.email({ email, password, name }, { onSuccess });
      if (error) {
        setError(error.message || "Sign up failed");
        setLoading(false);
        return;
      }
    }

    setLoading(false);
    navigate("/");
  }

  return (
    <div className="flex items-center justify-center min-h-screen bg-surface-primary">
      <div className="w-full max-w-sm p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-bold tracking-tight text-content-primary">
            Agent <span className="text-accent">Kanban</span>
          </h1>
          <p className="mt-2 text-sm text-content-secondary">{mode === "signin" ? "Sign in to your account" : "Create a new account"}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
              className="w-full bg-surface-secondary border border-border rounded-lg px-3 py-2 text-sm text-content-primary outline-none focus:border-accent transition-colors"
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            className="w-full bg-surface-secondary border border-border rounded-lg px-3 py-2 text-sm text-content-primary outline-none focus:border-accent transition-colors"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className="w-full bg-surface-secondary border border-border rounded-lg px-3 py-2 text-sm text-content-primary outline-none focus:border-accent transition-colors"
          />

          {error && <p className="text-sm text-error">{error}</p>}

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-accent text-surface-primary font-semibold text-sm py-2 rounded-lg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {loading ? "..." : mode === "signin" ? "Sign In" : "Sign Up"}
          </button>
        </form>

        <div className="relative">
          <div className="absolute inset-0 flex items-center">
            <div className="w-full border-t border-border" />
          </div>
          <div className="relative flex justify-center text-xs">
            <span className="bg-surface-primary px-2 text-content-tertiary">or</span>
          </div>
        </div>

        <button
          onClick={() => authClient.signIn.social({ provider: "github", callbackURL: "/auth/callback" })}
          className="w-full flex items-center justify-center gap-2 bg-surface-secondary border border-border text-content-primary font-semibold text-sm py-2 rounded-lg hover:bg-surface-tertiary transition-colors"
        >
          <GitHubIcon />
          Continue with GitHub
        </button>

        <p className="text-center text-xs text-content-tertiary">
          {mode === "signin" ? "No account? " : "Already have an account? "}
          <button
            onClick={() => {
              setMode(mode === "signin" ? "signup" : "signin");
              setError(null);
            }}
            className="text-accent hover:underline"
          >
            {mode === "signin" ? "Sign up" : "Sign in"}
          </button>
        </p>
      </div>
    </div>
  );
}
