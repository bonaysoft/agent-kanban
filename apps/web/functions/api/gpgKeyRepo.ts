import * as openpgp from "openpgp";
import { type D1, newId } from "./db";

export interface GpgKey {
  id: string;
  owner_id: string;
  armored_public_key: string;
  fingerprint: string;
  created_at: string;
  updated_at: string;
}

interface GpgKeyRow extends GpgKey {
  armored_private_key: string;
}

async function generateRootKey(): Promise<{ armoredPrivateKey: string; armoredPublicKey: string; fingerprint: string }> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "curve25519",
    userIDs: [{ name: "Agent Kanban Root", email: "root@mails.agent-kanban.dev" }],
    format: "armored",
  });
  const parsed = await openpgp.readPrivateKey({ armoredKey: privateKey as string });
  const fingerprint = parsed.getFingerprint();
  return { armoredPrivateKey: privateKey as string, armoredPublicKey: publicKey as string, fingerprint };
}

export async function getOrCreateRootKey(db: D1, ownerId: string): Promise<GpgKey> {
  const existing = await db
    .prepare("SELECT id, owner_id, armored_public_key, fingerprint, created_at, updated_at FROM gpg_keys WHERE owner_id = ?")
    .bind(ownerId)
    .first<GpgKey>();
  if (existing) return existing;

  const { armoredPrivateKey, armoredPublicKey, fingerprint } = await generateRootKey();
  const id = newId();
  const now = new Date().toISOString();

  await db
    .prepare(
      "INSERT INTO gpg_keys (id, owner_id, armored_private_key, armored_public_key, fingerprint, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(id, ownerId, armoredPrivateKey, armoredPublicKey, fingerprint, now, now)
    .run();

  return { id, owner_id: ownerId, armored_public_key: armoredPublicKey, fingerprint, created_at: now, updated_at: now };
}

// Adds a new signing subkey to the owner's root key.
// Uses optimistic locking (updated_at comparison) to detect concurrent writes
// and retries up to 3 times to avoid the TOCTOU race between read and update.
export async function addSubkey(db: D1, ownerId: string): Promise<{ fingerprint: string; keyId: string } | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const row = await db
      .prepare("SELECT armored_private_key, updated_at FROM gpg_keys WHERE owner_id = ?")
      .bind(ownerId)
      .first<Pick<GpgKeyRow, "armored_private_key"> & { updated_at: string }>();
    if (!row) return null;

    const rootKey = await openpgp.readPrivateKey({ armoredKey: row.armored_private_key });
    const existingFingerprints = new Set(rootKey.getSubkeys().map((sk) => sk.getFingerprint()));
    const updatedKey = await rootKey.addSubkey({ type: "curve25519", sign: true });
    const armoredPrivate = updatedKey.armor();
    const armoredPublic = updatedKey.toPublic().armor();

    const newSubkey = updatedKey.getSubkeys().find((sk) => !existingFingerprints.has(sk.getFingerprint()));
    if (!newSubkey) throw new Error("addSubkey: could not identify newly added subkey");

    const subkeyFingerprint = newSubkey.getFingerprint();
    const keyId = newSubkey.getKeyID().toHex();

    const now = new Date().toISOString();
    const result = await db
      .prepare("UPDATE gpg_keys SET armored_private_key = ?, armored_public_key = ?, updated_at = ? WHERE owner_id = ? AND updated_at = ?")
      .bind(armoredPrivate, armoredPublic, now, ownerId, row.updated_at)
      .run();

    if (result.meta.changes > 0) return { fingerprint: subkeyFingerprint, keyId };
    // Another writer updated the key between our read and write — retry.
  }
  throw new Error("addSubkey: failed to update root key after 3 attempts due to concurrent writes");
}

export async function getRootPublicKey(db: D1, ownerId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT armored_public_key FROM gpg_keys WHERE owner_id = ?")
    .bind(ownerId)
    .first<Pick<GpgKey, "armored_public_key">>();
  return row?.armored_public_key ?? null;
}

export async function getRootPrivateKey(db: D1, ownerId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT armored_private_key FROM gpg_keys WHERE owner_id = ?")
    .bind(ownerId)
    .first<Pick<GpgKeyRow, "armored_private_key">>();
  return row?.armored_private_key ?? null;
}
