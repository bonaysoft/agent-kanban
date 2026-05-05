import { CheckCircle2, Github, Monitor, RefreshCw, Shield } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { accountAuthClient, type LinkedAccount, type SessionEntry, useSession } from "../lib/auth-client";
import { cn } from "../lib/utils";

const APP_VERSION = __APP_VERSION__;

// ─── Account page root ───────────────────────────────────────────────────────

export function AccountPage() {
  const { data: session } = useSession();
  const user = session?.user as { email?: string | null; emailVerified?: boolean; createdAt?: Date | string | null } | undefined;
  const currentToken = (session?.session as { token?: string } | undefined)?.token;

  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [accountsError, setAccountsError] = useState<string | null>(null);

  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);
  const [sessionsError, setSessionsError] = useState<string | null>(null);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    setAccountsError(null);
    const { data, error } = await accountAuthClient.listAccounts();
    setAccountsLoading(false);
    if (error) {
      const msg = error.message || "Failed to load login methods";
      setAccountsError(msg);
      toast.error(msg);
    } else {
      setAccounts(data);
    }
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    setSessionsError(null);
    const { data, error } = await accountAuthClient.listSessions();
    setSessionsLoading(false);
    if (error) {
      const msg = error.message || "Failed to load sessions";
      setSessionsError(msg);
      toast.error(msg);
    } else {
      setSessions(data);
    }
  }, []);

  useEffect(() => {
    loadAccounts();
    loadSessions();
  }, [loadAccounts, loadSessions]);

  const hasCredentialAccount = accounts?.some((a) => a.providerId === "credential") ?? false;
  const githubAccount = accounts?.find((a) => a.providerId === "github");

  const [githubConnecting, setGithubConnecting] = useState(false);
  const [githubError, setGithubError] = useState<string | null>(null);

  async function handleConnectGitHub() {
    setGithubConnecting(true);
    setGithubError(null);
    const { error } = await accountAuthClient.linkSocial({ provider: "github", callbackURL: "/settings/account" });
    setGithubConnecting(false);
    if (error) {
      const msg = error.message || "Failed to connect GitHub";
      setGithubError(msg);
      toast.error(msg);
    }
  }

  return (
    <main className="min-w-0 flex-1 space-y-8">
      <div className="border-b border-border pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-content-primary">Account</h1>
        <p className="mt-1 text-sm text-content-secondary">Manage login methods, security, and active sessions.</p>
      </div>

      {/* Identity summary */}
      <section className="space-y-4">
        <SectionHeader icon={Shield} title="Identity" />
        <div className="max-w-2xl space-y-3 rounded-lg border border-border bg-surface-secondary p-4">
          <InfoRow label="Email">
            <span className="font-mono text-sm text-content-primary">{user?.email ?? "—"}</span>
            <EmailVerificationBadge verified={user?.emailVerified === true} />
          </InfoRow>
          {user?.createdAt && (
            <InfoRow label="Member since">
              <span className="font-mono text-sm text-content-secondary">
                {new Date(user.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" })}
              </span>
            </InfoRow>
          )}
          <InfoRow label="Login methods">
            {accountsLoading ? (
              <Skeleton className="h-5 w-32" />
            ) : accountsError ? (
              <span className="text-sm text-error">{accountsError}</span>
            ) : accounts && accounts.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {accounts.map((a) => (
                  <ProviderBadge key={a.id} providerId={a.providerId} />
                ))}
              </div>
            ) : (
              <span className="text-sm text-content-tertiary">None found</span>
            )}
          </InfoRow>
          <InfoRow label="App version">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-content-tertiary">v{APP_VERSION}</span>
          </InfoRow>
        </div>
      </section>

      {/* GitHub connection */}
      <section className="space-y-4">
        <SectionHeader icon={Github} title="GitHub" />
        <div className="max-w-2xl rounded-lg border border-border bg-surface-secondary p-4">
          {accountsLoading ? (
            <Skeleton className="h-8 w-48" />
          ) : accountsError ? (
            <p role="alert" className="text-sm text-error">
              {accountsError}
            </p>
          ) : githubAccount ? (
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-content-primary">GitHub connected</p>
                <p className="text-xs text-content-tertiary">
                  Account ID: <span className="font-mono">{githubAccount.accountId}</span>
                </p>
                {githubError && (
                  <p role="alert" className="text-xs text-error">
                    {githubError}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={handleConnectGitHub} disabled={githubConnecting} className="shrink-0">
                <RefreshCw className="size-3.5" />
                {githubConnecting ? "Connecting..." : "Reconnect"}
              </Button>
            </div>
          ) : (
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-content-primary">GitHub not connected</p>
                <p className="text-xs text-content-tertiary">Connect GitHub to enable agent identity sync and GPG key integration.</p>
                {githubError && (
                  <p role="alert" className="text-xs text-error">
                    {githubError}
                  </p>
                )}
              </div>
              <Button size="sm" onClick={handleConnectGitHub} disabled={githubConnecting} className="shrink-0">
                <Github className="size-3.5" />
                {githubConnecting ? "Connecting..." : "Connect GitHub"}
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Change password */}
      <ChangePasswordSection hasCredentialAccount={hasCredentialAccount} accountsLoading={accountsLoading} accountsError={accountsError} />

      {/* Active sessions */}
      <SessionsSection
        sessions={sessions}
        sessionsLoading={sessionsLoading}
        sessionsError={sessionsError}
        currentToken={currentToken}
        onRevoked={loadSessions}
      />
    </main>
  );
}

// ─── Change password section ─────────────────────────────────────────────────

function ChangePasswordSection({
  hasCredentialAccount,
  accountsLoading,
  accountsError,
}: {
  hasCredentialAccount: boolean;
  accountsLoading: boolean;
  accountsError: string | null;
}) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const confirmMismatch = confirmPassword.length > 0 && newPassword !== confirmPassword;
  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && newPassword === confirmPassword && !saving;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setSuccess(false);
    setSaving(true);
    const { error: err } = await accountAuthClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: false });
    setSaving(false);
    if (err) {
      setError(err.message || "Failed to change password");
      toast.error("Failed to change password");
      return;
    }
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSuccess(true);
    toast.success("Password changed");
  }

  return (
    <section className="space-y-4">
      <SectionHeader icon={Shield} title="Password" />
      <div className="max-w-2xl rounded-lg border border-border bg-surface-secondary p-4">
        {accountsLoading ? (
          <Skeleton className="h-8 w-48" />
        ) : accountsError ? (
          <p role="alert" className="text-sm text-error">
            {accountsError}
          </p>
        ) : !hasCredentialAccount ? (
          <p className="text-sm text-content-secondary">Your account uses OAuth only. Password change is not available for OAuth-only accounts.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <PasswordField
              label="Current password"
              id="current-password"
              value={currentPassword}
              onChange={setCurrentPassword}
              autoComplete="current-password"
            />
            <PasswordField
              label="New password"
              id="new-password"
              value={newPassword}
              onChange={setNewPassword}
              autoComplete="new-password"
              aria-invalid={newPassword.length > 0 && newPassword.length < 8}
            >
              {newPassword.length > 0 && newPassword.length < 8 && <p className="text-xs text-error">Password must be at least 8 characters.</p>}
            </PasswordField>
            <PasswordField
              label="Confirm new password"
              id="confirm-password"
              value={confirmPassword}
              onChange={setConfirmPassword}
              autoComplete="new-password"
              aria-invalid={confirmMismatch}
            >
              {confirmMismatch && <p className="text-xs text-error">Passwords do not match.</p>}
            </PasswordField>

            {error && (
              <p role="alert" className="text-sm text-error">
                {error}
              </p>
            )}
            {success && (
              <p role="status" className="flex items-center gap-1.5 text-sm text-success">
                <CheckCircle2 className="size-4" />
                Password changed successfully.
              </p>
            )}

            <div className="pt-1">
              <Button type="submit" disabled={!canSubmit}>
                {saving ? "Saving..." : "Change password"}
              </Button>
            </div>
          </form>
        )}
      </div>
    </section>
  );
}

// ─── Sessions section ────────────────────────────────────────────────────────

function SessionsSection({
  sessions,
  sessionsLoading,
  sessionsError,
  currentToken,
  onRevoked,
}: {
  sessions: SessionEntry[] | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  currentToken: string | undefined;
  onRevoked: () => void;
}) {
  const [revoking, setRevoking] = useState(false);
  const otherSessions = useMemo(() => sessions?.filter((s) => s.token !== currentToken) ?? [], [sessions, currentToken]);

  async function handleRevokeOthers() {
    setRevoking(true);
    const { error } = await accountAuthClient.revokeOtherSessions();
    setRevoking(false);
    if (error) {
      toast.error(error.message || "Failed to revoke sessions");
      return;
    }
    toast.success("Other sessions revoked");
    onRevoked();
  }

  return (
    <section className="space-y-4">
      <SectionHeader icon={Monitor} title="Active sessions" />
      <div className="max-w-2xl space-y-2">
        {sessionsLoading ? (
          <>
            <Skeleton className="h-14 w-full rounded-lg" />
            <Skeleton className="h-14 w-full rounded-lg" />
          </>
        ) : sessionsError ? (
          <p role="alert" className="text-sm text-error">
            {sessionsError}
          </p>
        ) : sessions && sessions.length > 0 ? (
          <>
            {sessions.map((s) => (
              <SessionRow key={s.id} session={s} isCurrent={s.token === currentToken} />
            ))}
            {otherSessions.length > 0 && (
              <div className="pt-2">
                <Button variant="outline" size="sm" onClick={handleRevokeOthers} disabled={revoking} className="text-error hover:text-error">
                  {revoking ? "Revoking..." : `Revoke other sessions (${otherSessions.length})`}
                </Button>
              </div>
            )}
          </>
        ) : (
          <p className="text-sm text-content-secondary">No active sessions found.</p>
        )}
      </div>
    </section>
  );
}

function SessionRow({ session, isCurrent }: { session: SessionEntry; isCurrent: boolean }) {
  const ua = parseUserAgent(session.userAgent);
  const date = new Date(session.createdAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border border-border bg-surface-secondary p-3",
        isCurrent && "border-accent/30 bg-accent-soft",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-content-primary">{ua}</span>
          {isCurrent && (
            <Badge variant="outline" className="border-accent/30 bg-accent/10 text-[10px] text-accent">
              Current
            </Badge>
          )}
        </div>
        <p className="font-mono text-xs text-content-tertiary">
          {session.ipAddress ? `${session.ipAddress} · ` : ""}Started {date}
        </p>
      </div>
    </div>
  );
}

function parseUserAgent(ua?: string | null): string {
  if (!ua) return "Unknown device";
  if (/iPhone|iPad|iOS/i.test(ua)) return "iOS";
  if (/Android/i.test(ua)) return "Android";
  if (/Windows/i.test(ua)) return "Windows browser";
  if (/Macintosh|Mac OS/i.test(ua)) return "macOS browser";
  if (/Linux/i.test(ua)) return "Linux browser";
  return "Browser";
}

// ─── Shared sub-components ───────────────────────────────────────────────────

function SectionHeader({ icon: Icon, title }: { icon: React.ElementType; title: string }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="size-4 text-content-tertiary" />
      <h2 className="text-sm font-semibold uppercase tracking-[0.06em] text-content-tertiary">{title}</h2>
    </div>
  );
}

function InfoRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <span className="w-28 shrink-0 text-xs uppercase tracking-[0.06em] text-content-tertiary">{label}</span>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </div>
  );
}

function ProviderBadge({ providerId }: { providerId: string }) {
  const label = providerId === "credential" ? "Email/Password" : providerId.charAt(0).toUpperCase() + providerId.slice(1);
  return (
    <Badge variant="outline" className="border-border text-content-secondary">
      {providerId === "github" && <Github className="size-3" />}
      {label}
    </Badge>
  );
}

function PasswordField({
  label,
  id,
  value,
  onChange,
  autoComplete,
  "aria-invalid": ariaInvalid,
  children,
}: {
  label: string;
  id: string;
  value: string;
  onChange: (v: string) => void;
  autoComplete: string;
  "aria-invalid"?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id} className="text-xs uppercase tracking-[0.06em] text-content-tertiary">
        {label}
      </Label>
      <Input
        id={id}
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={ariaInvalid}
      />
      {children}
    </div>
  );
}

function EmailVerificationBadge({ verified }: { verified: boolean }) {
  if (verified) {
    return (
      <Badge variant="outline" className="border-success/30 bg-success/10 text-success">
        <CheckCircle2 className="size-3" />
        Verified
      </Badge>
    );
  }

  return (
    <Badge variant="outline" className="border-warning/30 bg-warning/10 text-warning">
      Unverified
    </Badge>
  );
}
