"use client";

import { DEFAULT_KDF_PARAMS } from "@/lib/config";
import { importAesKey } from "@/lib/crypto/aes";
import { fromB64Url, randomBytes, sha256B64Url, toB64Url } from "@/lib/crypto/encoding";
import { generateRecoveryKey } from "@/lib/crypto/ids";
import {
  computeVerifierHash,
  deriveRoomKeys,
  unwrapEpochKey,
  wrapEpochKey,
} from "@/lib/crypto/keys";
import {
  decryptMemberName,
  decryptMessagePayload,
  decryptRoomName,
  encryptRoomName,
} from "@/lib/crypto/protocol";
import type { EncryptedBox, KdfParams } from "@/types/crypto";
import type { MessageEnvelope, MessagePayload } from "@/types/message";
import type { RoomMaterial } from "@/types/room";
import { getEpochKey, type RoomKeys } from "./keystore";
import { workerDeriveMasterKey } from "./worker-client";

export interface DerivedCredentials {
  kek: CryptoKey;
  authKeyB64: string;
}

/** Password → Argon2id (worker) → HKDF split. */
export async function deriveCredentials(
  password: string,
  saltB64: string,
  kdf: KdfParams,
): Promise<DerivedCredentials> {
  const masterKey = await workerDeriveMasterKey(password, saltB64, kdf);
  const derived = await deriveRoomKeys(masterKey);
  // Best-effort scrubbing of the master key copy in this realm.
  masterKey.fill(0);
  return { kek: derived.kek, authKeyB64: derived.authKeyB64 };
}

/**
 * Prepares all client-side crypto for room creation. The room ID is
 * generated in the browser (192 random bits) because the epoch-key wrapping
 * and room-name encryption bind it into their AAD; the server validates the
 * format and rejects the (practically impossible) collision, in which case
 * the client simply retries with a fresh ID.
 */
export async function prepareCreate(
  roomName: string,
  password: string,
): Promise<{
  salt: string;
  kdf: KdfParams;
  authKeyB64: string;
  kek: CryptoKey;
  epochKeyRaw: Uint8Array;
  epochKey: CryptoKey;
  recoveryKey: string;
  recoveryKeyHash: string;
  verifierPreview: string;
  roomName: string;
}> {
  const salt = toB64Url(randomBytes(16));
  const kdf: KdfParams = { ...DEFAULT_KDF_PARAMS };
  const { kek, authKeyB64 } = await deriveCredentials(password, salt, kdf);
  const epochKeyRaw = randomBytes(32);
  const epochKey = await importAesKey(epochKeyRaw);
  const recoveryKey = generateRecoveryKey();
  const recoveryKeyHash = await sha256B64Url(fromB64Url(recoveryKey));
  const verifierPreview = await computeVerifierHash(fromB64Url(authKeyB64));
  return {
    salt,
    kdf,
    authKeyB64,
    kek,
    epochKeyRaw,
    epochKey,
    recoveryKey,
    recoveryKeyHash,
    verifierPreview,
    roomName,
  };
}

/**
 * Builds unwrapped RoomKeys from server material after a successful unlock.
 * Epochs that fail to unwrap (e.g. wrapped under a newer password) are
 * skipped — messages in those epochs render as locked.
 */
export async function keysFromMaterial(
  roomId: string,
  kek: CryptoKey,
  authKeyB64: string,
  material: RoomMaterial,
): Promise<RoomKeys> {
  const epochKeys = new Map<number, { key: CryptoKey; raw: Uint8Array }>();
  for (const entry of material.epochs) {
    try {
      const raw = await unwrapEpochKey(
        kek,
        entry.wrappedKey,
        roomId,
        entry.epoch,
      );
      epochKeys.set(entry.epoch, { key: await importAesKey(raw), raw });
    } catch {
      // Skip epochs this KEK cannot open.
    }
  }
  return {
    kek,
    authKeyB64,
    cryptoVersion: material.cryptoVersion,
    currentEpoch: material.currentEpoch,
    epochKeys,
  };
}

export async function wrapEpoch(
  kek: CryptoKey,
  epochKeyRaw: Uint8Array,
  roomId: string,
  epoch: number,
): Promise<EncryptedBox> {
  return wrapEpochKey(kek, epochKeyRaw, roomId, epoch);
}

export async function decryptRoomNameSafe(
  roomId: string,
  box: EncryptedBox,
  epoch: number,
): Promise<string | null> {
  const key = getEpochKey(roomId, epoch);
  if (!key) return null;
  try {
    return await decryptRoomName(key.key, box, roomId, epoch);
  } catch {
    return null;
  }
}

export async function decryptMemberNameSafe(
  roomId: string,
  box: EncryptedBox | null,
  epoch: number | null,
): Promise<string | null> {
  if (!box || epoch === null) return null;
  const key = getEpochKey(roomId, epoch);
  if (!key) return null;
  try {
    return await decryptMemberName(key.key, box, roomId, epoch);
  } catch {
    return null;
  }
}

export type DecryptResult =
  | { ok: true; payload: MessagePayload }
  | { ok: false; reason: "locked" | "corrupt" };

/** Decrypts a message envelope; never throws. */
export async function decryptEnvelopeSafe(
  envelope: MessageEnvelope,
): Promise<DecryptResult> {
  if (envelope.protocolVersion !== 1) {
    return { ok: false, reason: "corrupt" };
  }
  const key = getEpochKey(envelope.roomId, envelope.keyEpoch);
  if (!key) return { ok: false, reason: "locked" };
  try {
    const payload = await decryptMessagePayload(
      key.key,
      { iv: envelope.iv, ct: envelope.ct },
      envelope.roomId,
      envelope.messageId,
      envelope.kind,
      envelope.keyEpoch,
    );
    return { ok: true, payload };
  } catch {
    return { ok: false, reason: "corrupt" };
  }
}

export { encryptRoomName };
