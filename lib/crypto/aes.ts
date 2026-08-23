import type { EncryptedBox } from "@/types/crypto";
import {
  fromB64Url,
  randomBytes,
  toArrayBuffer,
  toB64Url,
  utf8Encode,
} from "./encoding";

export const AES_IV_BYTES = 12;

export async function importAesKey(
  keyBytes: Uint8Array,
  usages: KeyUsage[] = ["encrypt", "decrypt"],
): Promise<CryptoKey> {
  if (keyBytes.length !== 32) throw new Error("AES-256 key must be 32 bytes");
  return crypto.subtle.importKey(
    "raw",
    toArrayBuffer(keyBytes),
    { name: "AES-GCM" },
    false,
    usages,
  );
}

/** AES-256-GCM with a fresh random 96-bit IV and authenticated AAD. */
export async function aesGcmEncrypt(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: string,
): Promise<EncryptedBox> {
  const iv = randomBytes(AES_IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(utf8Encode(aad)),
    },
    key,
    toArrayBuffer(plaintext),
  );
  return { iv: toB64Url(iv), ct: toB64Url(new Uint8Array(ct)) };
}

export async function aesGcmDecrypt(
  key: CryptoKey,
  box: EncryptedBox,
  aad: string,
): Promise<Uint8Array> {
  const pt = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(fromB64Url(box.iv)),
      additionalData: toArrayBuffer(utf8Encode(aad)),
    },
    key,
    toArrayBuffer(fromB64Url(box.ct)),
  );
  return new Uint8Array(pt);
}

/** Binary chunk form: [12-byte IV || ciphertext]. Used for attachment chunks. */
export async function aesGcmEncryptChunk(
  key: CryptoKey,
  plaintext: Uint8Array,
  aad: string,
): Promise<Uint8Array> {
  const iv = randomBytes(AES_IV_BYTES);
  const ct = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(utf8Encode(aad)),
    },
    key,
    toArrayBuffer(plaintext),
  );
  const out = new Uint8Array(AES_IV_BYTES + ct.byteLength);
  out.set(iv, 0);
  out.set(new Uint8Array(ct), AES_IV_BYTES);
  return out;
}

export async function aesGcmDecryptChunk(
  key: CryptoKey,
  data: Uint8Array,
  aad: string,
): Promise<Uint8Array> {
  if (data.length <= AES_IV_BYTES) throw new Error("Chunk too short");
  const iv = data.subarray(0, AES_IV_BYTES);
  const ct = data.subarray(AES_IV_BYTES);
  const pt = await crypto.subtle.decrypt(
    {
      name: "AES-GCM",
      iv: toArrayBuffer(iv),
      additionalData: toArrayBuffer(utf8Encode(aad)),
    },
    key,
    toArrayBuffer(ct),
  );
  return new Uint8Array(pt);
}
