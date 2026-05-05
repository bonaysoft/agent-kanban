import { CheckCircle2, CircleAlert, Github, Monitor, RefreshCw, Shield } from "lucide-react";
import type React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate, NavLink, Route, Routes } from "react-router-dom";
import { toast } from "sonner";
import { Header } from "../components/Header";
import { Avatar, AvatarFallback, AvatarImage } from "../components/ui/avatar";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Skeleton } from "../components/ui/skeleton";
import { authClient, useSession } from "../lib/auth-client";
import { cn } from "../lib/utils";

type SettingsUser = {
  name?: string | null;
  email?: string | null;
  image?: string | null;
  emailVerified?: boolean;
};

const settingsLinks = [
  { to: "/settings/profile", label: "Profile" },
  { to: "/settings/account", label: "Account" },
];

function ProfileSettingsPage() {
  const { data: session, refetch } = useSession();
  const user = session?.user as SettingsUser | undefined;
  const [name, setName] = useState(user?.name ?? "");
  const [image, setImage] = useState(user?.image ?? "");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setName(user?.name ?? "");
    setImage(user?.image ?? "");
  }, [user?.name, user?.image]);

  const trimmedName = name.trim();
  const trimmedImage = image.trim();
  const imageError = useMemo(() => imageValidationError(trimmedImage), [trimmedImage]);
  const isDirty = trimmedName !== (user?.name ?? "") || trimmedImage !== (user?.image ?? "");
  const canSave = isDirty && trimmedName.length > 0 && !imageError && !isSaving;
  const fallback = profileInitial(trimmedName || user?.email || "?");

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSave) return;

    setError(null);
    setIsSaving(true);
    const { error } = await authClient.updateUser({
      name: trimmedName,
      image: trimmedImage || null,
    } as any);
    setIsSaving(false);

    if (error) {
      setError(error.message || "Failed to save profile");
      toast.error("Failed to save profile");
      return;
    }

    await refetch();
    toast.success("Profile saved");
  }

  return (
    <main className="min-w-0 flex-1 space-y-6">
      <div className="border-b border-border pb-4">
        <h1 className="text-xl font-semibold tracking-tight text-content-primary">Profile</h1>
        <p className="mt-1 text-sm text-content-secondary">Manage the identity shown across Agent Kanban.</p>
      </div>

      <form onSubmit={handleSubmit} className="max-w-2xl space-y-6">
        <section className="space-y-4">
          <div className="grid gap-4 md:grid-cols-[96px_1fr]">
            <div>
              <Label className="mb-2 text-xs uppercase tracking-[0.06em] text-content-tertiary">Preview</Label>
              <Avatar size="lg" className="size-14">
                {trimmedImage && !imageError && <AvatarImage src={trimmedImage} alt="" />}
                <AvatarFallback className="text-base font-semibold">{fallback}</AvatarFallback>
              </Avatar>
            </div>

            <div className="space-y-4">
              <Field label="Display name" htmlFor="profile-name">
                <Input
                  id="profile-name"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={trimmedName.length === 0}
                  autoComplete="name"
                />
                {trimmedName.length === 0 && <p className="text-xs text-error">Display name is required.</p>}
              </Field>

              <Field label="Image URL" htmlFor="profile-image">
                <Input
                  id="profile-image"
                  value={image}
                  onChange={(event) => setImage(event.target.value)}
                  aria-invalid={!!imageError}
                  autoComplete="url"
                  placeholder="https://example.com/avatar.png"
                />
                {imageError && <p className="text-xs text-error">{imageError}</p>}
              </Field>
            </div>
          </div>
        </section>

        <section className="grid gap-4 border-t border-border pt-5 md:grid-cols-2">
          <Field label="Email" htmlFor="profile-email">
            <Input id="profile-email" value={user?.email ?? ""} readOnly className="text-content-secondary" />
          </Field>

          <div>
            <Label className="mb-2 text-xs uppercase tracking-[0.06em] text-content-tertiary">Email verification</Label>
            <EmailVerificationBadge verified={user?.emailVerified === true} />
          </div>
        </section>

        {error && (
          <p role="alert" className="text-sm text-error">
            {error}
          </p>
        )}

        <div className="flex items-center gap-3 border-t border-border pt-5">
          <Button type="submit" disabled={!canSave}>
            {isSaving ? "Saving..." : "Save profile"}
          </Button>
          {!isDirty && <p className="text-xs text-content-tertiary">No unsaved changes</p>}
        </div>
      </form>
    </main>
  );
}

// ─── Account types ──────────────────────────────────────────────────────────

type LinkedAccount = {
  id: string;
  providerId: string;
  accountId: string;
  createdAt: Date;
  scopes: string[];
};

type SessionEntry = {
  id: string;
  token: string;
  createdAt: Date;
  updatedAt: Date;
  expiresAt: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
  userId: string;
};

// ─── Account Settings ────────────────────────────────────────────────────────

function AccountSettingsPage_() {
  const { data: session } = useSession();
  const user = session?.user as { email?: string | null; emailVerified?: boolean; createdAt?: Date | string | null } | undefined;
  const currentToken = (session?.session as { token?: string } | undefined)?.token;

  const [accounts, setAccounts] = useState<LinkedAccount[] | null>(null);
  const [accountsLoading, setAccountsLoading] = useState(true);
  const [sessions, setSessions] = useState<SessionEntry[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(true);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    const { data, error } = await (authClient as any).listAccounts();
    setAccountsLoading(false);
    if (!error && data) setAccounts(data as LinkedAccount[]);
  }, []);

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true);
    const { data, error } = await (authClient as any).listSessions();
    setSessionsLoading(false);
    if (!error && data) setSessions(data as SessionEntry[]);
  }, []);

  useEffect(() => {
    loadAccounts();
    loadSessions();
  }, [loadAccounts, loadSessions]);

  const hasCredentialAccount = accounts?.some((a) => a.providerId === "credential") ?? false;
  const githubAccount = accounts?.find((a) => a.providerId === "github");

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
          ) : githubAccount ? (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-content-primary">GitHub connected</p>
                <p className="text-xs text-content-tertiary">
                  Account ID: <span className="font-mono">{githubAccount.accountId}</span>
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={() => connectGitHub()} className="shrink-0">
                <RefreshCw className="size-3.5" />
                Reconnect
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <div className="space-y-0.5">
                <p className="text-sm font-medium text-content-primary">GitHub not connected</p>
                <p className="text-xs text-content-tertiary">Connect GitHub to enable agent identity sync and GPG key integration.</p>
              </div>
              <Button size="sm" onClick={() => connectGitHub()} className="shrink-0">
                <Github className="size-3.5" />
                Connect GitHub
              </Button>
            </div>
          )}
        </div>
      </section>

      {/* Change password */}
      <ChangePasswordSection hasCredentialAccount={hasCredentialAccount} accountsLoading={accountsLoading} />

      {/* Active sessions */}
      <SessionsSection sessions={sessions} sessionsLoading={sessionsLoading} currentToken={currentToken} onRevoked={loadSessions} />
    </main>
  );
}

function connectGitHub() {
  (authClient as any).linkSocial({ provider: "github", callbackURL: "/settings/account" });
}

// ─── Change password section ─────────────────────────────────────────────────

function ChangePasswordSection({ hasCredentialAccount, accountsLoading }: { hasCredentialAccount: boolean; accountsLoading: boolean }) {
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
    const { error: err } = await (authClient as any).changePassword({ currentPassword, newPassword, revokeOtherSessions: false });
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
        ) : !hasCredentialAccount ? (
          <p className="text-sm text-content-secondary">Your account uses OAuth only. Password change is not available for OAuth-only accounts.</p>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <Field label="Current password" htmlFor="current-password">
              <Input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>
            <Field label="New password" htmlFor="new-password">
              <Input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={newPassword.length > 0 && newPassword.length < 8}
              />
              {newPassword.length > 0 && newPassword.length < 8 && <p className="text-xs text-error">Password must be at least 8 characters.</p>}
            </Field>
            <Field label="Confirm new password" htmlFor="confirm-password">
              <Input
                id="confirm-password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                aria-invalid={confirmMismatch}
              />
              {confirmMismatch && <p className="text-xs text-error">Passwords do not match.</p>}
            </Field>

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
  currentToken,
  onRevoked,
}: {
  sessions: SessionEntry[] | null;
  sessionsLoading: boolean;
  currentToken: string | undefined;
  onRevoked: () => void;
}) {
  const [revoking, setRevoking] = useState(false);

  const otherSessions = useMemo(() => sessions?.filter((s) => s.token !== currentToken) ?? [], [sessions, currentToken]);

  async function handleRevokeOthers() {
    setRevoking(true);
    const { error } = await (authClient as any).revokeOtherSessions();
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
        "flex items-start justify-between gap-3 rounded-lg border border-border bg-surface-secondary p-3",
        isCurrent && "border-accent/30 bg-accent-soft",
      )}
    >
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-content-primary">{ua}</span>
          {isCurrent && (
            <Badge variant="outline" className="border-accent/30 bg-accent/10 text-accent text-[10px]">
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

const APP_VERSION = __APP_VERSION__;

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

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-xs uppercase tracking-[0.06em] text-content-tertiary">
        {label}
      </Label>
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
      <CircleAlert className="size-3" />
      Unverified
    </Badge>
  );
}

function imageValidationError(value: string): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "Image URL must use http or https.";
    return null;
  } catch {
    return "Image URL must be a valid URL.";
  }
}

function profileInitial(value: string) {
  return value.trim().charAt(0).toUpperCase() || "?";
}

export function AccountSettingsPage() {
  return (
    <div className="min-h-screen bg-surface-primary">
      <Header />
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-8 md:flex-row md:px-8">
        <aside className="w-full shrink-0 md:w-48">
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-content-tertiary">Settings</h2>
          <nav aria-label="Settings" className="space-y-1">
            {settingsLinks.map((link) => (
              <NavLink
                key={link.to}
                to={link.to}
                className={({ isActive }) =>
                  cn(
                    "block rounded-md px-3 py-2 text-sm font-medium transition-colors",
                    isActive ? "bg-accent-soft text-accent" : "text-content-secondary hover:bg-surface-secondary hover:text-content-primary",
                  )
                }
              >
                {link.label}
              </NavLink>
            ))}
          </nav>
        </aside>

        <Routes>
          <Route index element={<Navigate to="profile" replace />} />
          <Route path="profile" element={<ProfileSettingsPage />} />
          <Route path="account" element={<AccountSettingsPage_ />} />
          <Route path="*" element={<Navigate to="profile" replace />} />
        </Routes>
      </div>
    </div>
  );
}
