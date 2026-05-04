import { useEffect, useState } from "react";
import { Header } from "../components/Header";

import { authClient } from "../lib/auth-client";
import { getTheme, setTheme, type Theme } from "../lib/theme";

function GitHubSection() {
  const [accounts, setAccounts] = useState<Array<{ providerId: string }>>([]);

  useEffect(() => {
    authClient.listAccounts().then((res: any) => {
      if (res.data) setAccounts(res.data);
    });
  }, []);

  const isConnected = accounts.some((a) => a.providerId === "github");

  async function handleConnect() {
    await authClient.signIn.social({ provider: "github", callbackURL: "/settings" });
  }

  return (
    <section className="space-y-3">
      <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">GitHub</h2>
      <div className="border border-border rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-content-primary font-medium">GitHub Account</p>
            <p className="text-xs text-content-tertiary mt-0.5">
              {isConnected ? "Connected — agent GPG keys and emails sync automatically." : "Not connected"}
            </p>
          </div>
          {!isConnected && (
            <button onClick={handleConnect} className="bg-accent text-[#09090B] font-medium text-xs px-3 py-1.5 rounded-md hover:opacity-90">
              Connect GitHub
            </button>
          )}
          {isConnected && <span className="text-xs text-green-500 font-medium">Connected</span>}
        </div>
      </div>
    </section>
  );
}

export function AccountSettingsPage() {
  const [currentTheme, setCurrentTheme] = useState<Theme>(getTheme());

  function handleTheme(theme: Theme) {
    setTheme(theme);
    setCurrentTheme(theme);
  }

  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="max-w-2xl mx-auto p-8 space-y-8">
        <h1 className="text-xl font-bold text-content-primary">Settings</h1>

        {/* Theme */}
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-content-tertiary uppercase tracking-wide">Theme</h2>
          <div className="flex gap-2">
            {(["light", "dark", "system"] as Theme[]).map((t) => (
              <button
                key={t}
                onClick={() => handleTheme(t)}
                className={`text-sm px-4 py-2 rounded-lg border transition-colors capitalize ${
                  currentTheme === t
                    ? "border-accent text-accent bg-accent-soft"
                    : "border-border text-content-secondary hover:border-content-tertiary"
                }`}
              >
                {t}
              </button>
            ))}
          </div>
        </section>

        {/* GitHub */}
        <GitHubSection />

        <p className="text-xs text-content-tertiary pt-4">Version {__APP_VERSION__}</p>
      </div>
    </div>
  );
}
