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

async function generateRootKey(ownerEmail: string): Promise<{ armoredPrivateKey: string; armoredPublicKey: string; fingerprint: string }> {
  const { privateKey, publicKey } = await openpgp.generateKey({
    type: "ecc",
    curve: "ed25519Legacy",
    userIDs: [{ name: "Agent Kanban", email: ownerEmail }],
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

  const owner = await db.prepare("SELECT email FROM user WHERE id = ?").bind(ownerId).first<{ email: string }>();
  if (!owner?.email) throw new Error("Owner email not found — cannot create GPG root key");
  const { armoredPrivateKey, armoredPublicKey, fingerprint } = await generateRootKey(owner.email);
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

export async function addSubkey(db: D1, ownerId: string, agentEmail: string): Promise<{ fingerprint: string; keyId: string } | null> {
  const row = await db
    .prepare("SELECT armored_private_key FROM gpg_keys WHERE owner_id = ?")
    .bind(ownerId)
    .first<Pick<GpgKeyRow, "armored_private_key">>();
  if (!row) return null;

  let privateKey = await openpgp.readPrivateKey({ armoredKey: row.armored_private_key });

  // Add agent email as a UID on the root key (required for GitHub signature verification)
  const existingUIDs = privateKey.users.map((u) => u.userID).filter(Boolean);
  const alreadyHasEmail = existingUIDs.some((uid) => uid?.email === agentEmail);
  if (!alreadyHasEmail) {
    const userIDs = [
      ...existingUIDs.map((uid) => ({ name: uid!.name ?? "Agent Kanban", email: uid!.email ?? "" })),
      { name: "Agent Kanban", email: agentEmail },
    ];
    const reformatted = await openpgp.reformatKey({ privateKey, userIDs, format: "object" });
    privateKey = reformatted.privateKey;
  }

  const updatedKey = await privateKey.addSubkey({ type: "ecc", curve: "ed25519Legacy", sign: true });
  const armoredPrivate = updatedKey.armor();
  const armoredPublic = updatedKey.toPublic().armor();

  const subkeys = updatedKey.getSubkeys();
  const newSubkey = subkeys[subkeys.length - 1];
  const subkeyFingerprint = newSubkey.getFingerprint();
  const keyId = newSubkey.getKeyID().toHex();

  const now = new Date().toISOString();
  await db
    .prepare("UPDATE gpg_keys SET armored_private_key = ?, armored_public_key = ?, updated_at = ? WHERE owner_id = ?")
    .bind(armoredPrivate, armoredPublic, now, ownerId)
    .run();

  return { fingerprint: subkeyFingerprint, keyId };
}

export async function getArmoredPrivateKey(db: D1, ownerId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT armored_private_key FROM gpg_keys WHERE owner_id = ?")
    .bind(ownerId)
    .first<Pick<GpgKeyRow, "armored_private_key">>();
  return row?.armored_private_key ?? null;
}

export async function getRootKeyInfo(db: D1, ownerId: string): Promise<{ armoredPublicKey: string; fingerprint: string } | null> {
  const row = await db
    .prepare("SELECT armored_public_key, fingerprint FROM gpg_keys WHERE owner_id = ?")
    .bind(ownerId)
    .first<{ armored_public_key: string; fingerprint: string }>();
  if (!row) return null;
  return { armoredPublicKey: row.armored_public_key, fingerprint: row.fingerprint };
}

export async function getRootPublicKey(db: D1, ownerId: string): Promise<string | null> {
  const row = await db
    .prepare("SELECT armored_public_key FROM gpg_keys WHERE owner_id = ?")
    .bind(ownerId)
    .first<Pick<GpgKey, "armored_public_key">>();
  return row?.armored_public_key ?? null;
}

export async function getSubkeyIds(armoredPublicKey: string): Promise<string[]> {
  const key = await openpgp.readKey({ armoredKey: armoredPublicKey });
  return key.getSubkeys().map((sk) => sk.getKeyID().toHex().toUpperCase());
}
