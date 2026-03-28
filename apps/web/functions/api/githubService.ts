import type { D1 } from "./db";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "agent-kanban/1.0";

interface GithubGpgKey {
  id: number;
  key_id: string;
}

export async function getGithubToken(db: D1, userId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT accessToken FROM account WHERE userId = ? AND providerId = 'github'")
    .bind(userId)
    .first<{ accessToken: string }>();
  return row?.accessToken ?? null;
}

export async function syncGpgKey(token: string, armoredPublicKey: string, fingerprint: string): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };

  const listRes = await fetch(`${GITHUB_API}/user/gpg_keys`, { headers });
  if (!listRes.ok) throw new Error(`GitHub list GPG keys failed: ${listRes.status}`);

  const keys = (await listRes.json()) as GithubGpgKey[];

  // GitHub key_id is the last 16 hex chars of the fingerprint (uppercased)
  const keyIdSuffix = fingerprint.toUpperCase().slice(-16);
  const existing = keys.find((k) => k.key_id.toUpperCase() === keyIdSuffix);

  if (existing) {
    await fetch(`${GITHUB_API}/user/gpg_keys/${existing.id}`, {
      method: "DELETE",
      headers,
    });
  }

  const createRes = await fetch(`${GITHUB_API}/user/gpg_keys`, {
    method: "POST",
    headers,
    body: JSON.stringify({ armored_public_key: armoredPublicKey }),
  });
  if (!createRes.ok) {
    const body = await createRes.text();
    throw new Error(`GitHub create GPG key failed: ${createRes.status} ${body}`);
  }
}

export async function addAgentEmail(token: string, email: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/user/emails`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ emails: [email] }),
  });
  // 422 = email already exists — treat as success
  if (!res.ok && res.status !== 422) {
    const body = await res.text();
    throw new Error(`GitHub add email failed: ${res.status} ${body}`);
  }
}
