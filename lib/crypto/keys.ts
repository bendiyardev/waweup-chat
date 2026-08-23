import type { EncryptedBox } from "@/types/crypto";
import { aesGcmDecrypt, aesGcmEncrypt, importAesKey } from "./aes";
import { sha256B64Url, toB64Url } from "./encoding";
import { hkdfDerive } from "./hkdf";

export const INFO_ENCRYPTION = "waweup/v1/encryption";
export const INFO_AUTHENTICATION = "waweup/v1/authentication";
export const INFO_FILE = "waweup/v1/file";

export interface DerivedRoomKeys {
  /** base64url auth key — sent to the server, which stores only its hash. */
  authKeyB64: string;
  /** Key-encryption key wrapping the random epoch keys. Never leaves the browser. */
  kek: CryptoKey;
}

/** Splits the Argon2id master key into independent auth and encryption keys. */
export async function deriveRoomKeys(
  masterKey: Uint8Array,
): Promise<DerivedRoomKeys> {
  const authKeyBytes = await hkdfDerive(masterKey, INFO_AUTHENTICATION);
  const kekBytes = await hkdfDerive(masterKey, INFO_ENCRYPTION);
  return {
    authKeyB64: toB64Url(authKeyBytes),
    kek: await importAesKey(kekBytes),
  };
}

/** The verifier the server stores: SHA-256 of the auth key. */
export async function computeVerifierHash(
  authKeyBytes: Uint8Array,
): Promise<string> {
  return sha256B64Url(authKeyBytes);
}

function epochAad(roomId: string, epoch: number): string {
  return `waweup/v1/epoch|${roomId}|${epoch}`;
}

export async function wrapEpochKey(
  kek: CryptoKey,
  epochKeyBytes: Uint8Array,
  roomId: string,
  epoch: number,
): Promise<EncryptedBox> {
  return aesGcmEncrypt(kek, epochKeyBytes, epochAad(roomId, epoch));
}

export async function unwrapEpochKey(
  kek: CryptoKey,
  wrapped: EncryptedBox,
  roomId: string,
  epoch: number,
): Promise<Uint8Array> {
  return aesGcmDecrypt(kek, wrapped, epochAad(roomId, epoch));
}

/** Per-attachment key derived from the epoch key. */
export async function deriveFileKey(
  epochKeyBytes: Uint8Array,
  attachmentId: string,
): Promise<CryptoKey> {
  const bytes = await hkdfDerive(epochKeyBytes, `${INFO_FILE}|${attachmentId}`);
  return importAesKey(bytes);
}
