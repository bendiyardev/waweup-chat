import { describe, expect, it } from "vitest";
import { aesGcmDecrypt, aesGcmDecryptChunk, aesGcmEncrypt, aesGcmEncryptChunk, importAesKey } from "@/lib/crypto/aes";
import { deriveMasterKey } from "@/lib/crypto/argon";
import { fromB64Url, randomBytes, toB64Url, utf8Encode } from "@/lib/crypto/encoding";
import { hkdfDerive } from "@/lib/crypto/hkdf";
import {
  generateRoomId,
  generateUlid,
  ROOM_ID_REGEX,
  toDescendingKey,
  ULID_REGEX,
} from "@/lib/crypto/ids";
import {
  computeVerifierHash,
  deriveRoomKeys,
  unwrapEpochKey,
  wrapEpochKey,
} from "@/lib/crypto/keys";
import {
  decryptMessagePayload,
  encryptMessagePayload,
  decryptRoomName,
  encryptRoomName,
} from "@/lib/crypto/protocol";
import type { KdfParams } from "@/types/crypto";

const FAST_KDF: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
};

describe("base64url encoding", () => {
  it("round-trips arbitrary bytes", () => {
    const bytes = randomBytes(37);
    expect(fromB64Url(toB64Url(bytes))).toEqual(bytes);
  });
});

describe("AES-256-GCM", () => {
  it("encrypts and decrypts with matching AAD", async () => {
    const key = await importAesKey(randomBytes(32));
    const box = await aesGcmEncrypt(key, utf8Encode("hello"), "aad-1");
    const plain = await aesGcmDecrypt(key, box, "aad-1");
    expect(new TextDecoder().decode(plain)).toBe("hello");
  });

  it("rejects the wrong key", async () => {
    const key = await importAesKey(randomBytes(32));
    const other = await importAesKey(randomBytes(32));
    const box = await aesGcmEncrypt(key, utf8Encode("secret"), "aad");
    await expect(aesGcmDecrypt(other, box, "aad")).rejects.toThrow();
  });

  it("rejects a tampered AAD", async () => {
    const key = await importAesKey(randomBytes(32));
    const box = await aesGcmEncrypt(key, utf8Encode("secret"), "aad-a");
    await expect(aesGcmDecrypt(key, box, "aad-b")).rejects.toThrow();
  });

  it("uses a fresh IV for every encryption", async () => {
    const key = await importAesKey(randomBytes(32));
    const a = await aesGcmEncrypt(key, utf8Encode("x"), "aad");
    const b = await aesGcmEncrypt(key, utf8Encode("x"), "aad");
    expect(a.iv).not.toBe(b.iv);
    expect(a.ct).not.toBe(b.ct);
  });

  it("chunk format round-trips and authenticates", async () => {
    const key = await importAesKey(randomBytes(32));
    const data = randomBytes(1024);
    const chunk = await aesGcmEncryptChunk(key, new Uint8Array(data), "c1");
    const plain = await aesGcmDecryptChunk(key, chunk, "c1");
    expect(plain).toEqual(data);
    chunk[20] = chunk[20]! ^ 0xff;
    await expect(aesGcmDecryptChunk(key, chunk, "c1")).rejects.toThrow();
  });
});

describe("HKDF", () => {
  it("separates domains", async () => {
    const ikm = randomBytes(32);
    const a = await hkdfDerive(ikm, "waweup/v1/encryption");
    const b = await hkdfDerive(ikm, "waweup/v1/authentication");
    expect(toB64Url(a)).not.toBe(toB64Url(b));
  });

  it("is deterministic", async () => {
    const ikm = randomBytes(32);
    const a = await hkdfDerive(ikm, "info");
    const b = await hkdfDerive(ikm, "info");
    expect(toB64Url(a)).toBe(toB64Url(b));
  });
});

describe("Argon2id + key hierarchy", () => {
  it("derives stable keys from password + salt", async () => {
    const salt = randomBytes(16);
    const m1 = await deriveMasterKey("correct horse battery", salt, FAST_KDF);
    const m2 = await deriveMasterKey("correct horse battery", salt, FAST_KDF);
    expect(toB64Url(m1)).toBe(toB64Url(m2));
    const wrong = await deriveMasterKey("wrong password!", salt, FAST_KDF);
    expect(toB64Url(wrong)).not.toBe(toB64Url(m1));
  });

  it("produces a verifier that does not reveal the auth key", async () => {
    const master = randomBytes(32);
    const { authKeyB64 } = await deriveRoomKeys(master);
    const verifier = await computeVerifierHash(fromB64Url(authKeyB64));
    expect(verifier).not.toBe(authKeyB64);
    expect(verifier).toHaveLength(43);
  });
});

describe("epoch key wrapping", () => {
  it("round-trips and binds room + epoch", async () => {
    const { kek } = await deriveRoomKeys(randomBytes(32));
    const epochKey = randomBytes(32);
    const wrapped = await wrapEpochKey(kek, epochKey, "room-a", 1);
    expect(await unwrapEpochKey(kek, wrapped, "room-a", 1)).toEqual(epochKey);
    await expect(unwrapEpochKey(kek, wrapped, "room-b", 1)).rejects.toThrow();
    await expect(unwrapEpochKey(kek, wrapped, "room-a", 2)).rejects.toThrow();
  });

  it("cannot be unwrapped by another password's KEK", async () => {
    const { kek } = await deriveRoomKeys(randomBytes(32));
    const { kek: other } = await deriveRoomKeys(randomBytes(32));
    const wrapped = await wrapEpochKey(kek, randomBytes(32), "room", 1);
    await expect(unwrapEpochKey(other, wrapped, "room", 1)).rejects.toThrow();
  });
});

describe("message protocol", () => {
  it("round-trips a payload bound to its envelope identity", async () => {
    const key = await importAesKey(randomBytes(32));
    const payload = { displayName: "Diyar", text: "Selam 👋" };
    const box = await encryptMessagePayload(key, payload, "r1", "M1", "text", 3);
    const out = await decryptMessagePayload(key, box, "r1", "M1", "text", 3);
    expect(out).toEqual(payload);
    await expect(
      decryptMessagePayload(key, box, "r1", "M2", "text", 3),
    ).rejects.toThrow();
    await expect(
      decryptMessagePayload(key, box, "r1", "M1", "file", 3),
    ).rejects.toThrow();
  });

  it("encrypts the room name", async () => {
    const key = await importAesKey(randomBytes(32));
    const box = await encryptRoomName(key, "plans", "room-x", 1);
    expect(box.ct).not.toContain("plans");
    expect(await decryptRoomName(key, box, "room-x", 1)).toBe("plans");
  });
});

describe("identifiers", () => {
  it("generates valid, unguessable room IDs", () => {
    const id = generateRoomId();
    expect(id).toMatch(ROOM_ID_REGEX);
    expect(generateRoomId()).not.toBe(id);
  });

  it("generates sortable ULIDs and inverts them correctly", () => {
    const a = generateUlid(1000);
    const b = generateUlid(2000);
    expect(a).toMatch(ULID_REGEX);
    expect(a < b).toBe(true);
    // Descending keys invert lexicographic order.
    expect(toDescendingKey(a) > toDescendingKey(b)).toBe(true);
    // Involution: applying twice returns the original.
    expect(toDescendingKey(toDescendingKey(a))).toBe(a);
  });

  it("keeps ULIDs monotonic within one millisecond", () => {
    const now = Date.now();
    const first = generateUlid(now);
    const second = generateUlid(now);
    expect(first < second).toBe(true);
  });
});
