import type { D1 } from "./db";

const GITHUB_API = "https://api.github.com";
const USER_AGENT = "agent-kanban/1.0";

interface GithubGpgKey {
  id: number;
  key_id: string;
  subkeys: { key_id: string }[];
}

export async function getGithubToken(db: D1, userId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT accessToken FROM account WHERE userId = ? AND providerId = 'github'")
    .bind(userId)
    .first<{ accessToken: string }>();
  return row?.accessToken ?? null;
}

export async function syncGpgKey(token: string, armoredPublicKey: string, fingerprint: string, subkeyIds: string[]): Promise<void> {
  const headers = {
    Authorization: `Bearer ${token}`,
    "User-Agent": USER_AGENT,
    "Content-Type": "application/json",
  };

  const listRes = await fetch(`${GITHUB_API}/user/gpg_keys`, { headers });
  if (!listRes.ok) throw new Error(`GitHub list GPG keys failed: ${listRes.status}`);

  const keys = (await listRes.json()) as GithubGpgKey[];

  // Delete any key that matches our root fingerprint or contains overlapping subkeys
  const rootKeyId = fingerprint.toUpperCase().slice(-16);
  const ourSubkeyIds = new Set(subkeyIds.map((id) => id.toUpperCase()));

  const toDelete = keys.filter((k) => {
    if (k.key_id.toUpperCase() === rootKeyId) return true;
    return k.subkeys?.some((sk) => ourSubkeyIds.has(sk.key_id.toUpperCase()));
  });

  for (const key of toDelete) {
    const delRes = await fetch(`${GITHUB_API}/user/gpg_keys/${key.id}`, { method: "DELETE", headers });
    if (!delRes.ok && delRes.status !== 404) {
      throw new Error(`GitHub delete GPG key ${key.id} failed: ${delRes.status}`);
    }
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

export async function removeAgentEmail(token: string, email: string): Promise<void> {
  const res = await fetch(`${GITHUB_API}/user/emails`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${token}`,
      "User-Agent": USER_AGENT,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ emails: [email] }),
  });
  if (!res.ok && res.status !== 404 && res.status !== 422) {
    const body = await res.text();
    throw new Error(`GitHub remove email failed: ${res.status} ${body}`);
  }
}
