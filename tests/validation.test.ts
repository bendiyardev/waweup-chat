import { describe, expect, it } from "vitest";
import {
  createRoomSchema,
  joinSchema,
  sendMessageSchema,
  uploadClientPayloadSchema,
} from "@/lib/validation/schemas";

const validCreate = {
  roomId: "a".repeat(32),
  encryptedRoomName: { iv: "a".repeat(16), ct: "b".repeat(24) },
  salt: "c".repeat(22),
  kdf: { algorithm: "argon2id", memoryKiB: 65536, iterations: 3, parallelism: 1 },
  authKey: "d".repeat(43),
  wrappedEpochKey: { iv: "a".repeat(16), ct: "e".repeat(64) },
  recoveryKeyHash: "f".repeat(43),
  expiresPreset: "7d",
};

describe("request validation", () => {
  it("accepts a valid create payload", () => {
    expect(createRoomSchema.safeParse(validCreate).success).toBe(true);
  });

  it("strictly rejects unknown fields", () => {
    expect(
      createRoomSchema.safeParse({ ...validCreate, role: "owner" }).success,
    ).toBe(false);
  });

  it("rejects non-base64url and out-of-preset values", () => {
    expect(
      createRoomSchema.safeParse({ ...validCreate, salt: "!!invalid!!" })
        .success,
    ).toBe(false);
    expect(
      createRoomSchema.safeParse({ ...validCreate, expiresPreset: "5000d" })
        .success,
    ).toBe(false);
    expect(
      createRoomSchema.safeParse({
        ...validCreate,
        kdf: { ...validCreate.kdf, memoryKiB: 1 },
      }).success,
    ).toBe(false);
  });

  it("bounds message ciphertext size and validates ULIDs", () => {
    const base = {
      messageId: "01ARZ3NDEKTSV4RRFFQ69G5FAV",
      kind: "text",
      keyEpoch: 1,
      iv: "a".repeat(16),
      ct: "b".repeat(100),
    };
    expect(sendMessageSchema.safeParse(base).success).toBe(true);
    expect(
      sendMessageSchema.safeParse({ ...base, messageId: "not-a-ulid" })
        .success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({ ...base, ct: "b".repeat(200_000) })
        .success,
    ).toBe(false);
    expect(
      sendMessageSchema.safeParse({ ...base, kind: "gif" }).success,
    ).toBe(false);
  });

  it("validates join and upload payloads", () => {
    expect(
      joinSchema.safeParse({
        encryptedDisplayName: { iv: "a".repeat(16), ct: "b".repeat(24) },
        displayNameEpoch: 1,
      }).success,
    ).toBe(true);
    expect(
      uploadClientPayloadSchema.safeParse({
        attachmentId: "g".repeat(16),
        chunkIndex: 1,
      }).success,
    ).toBe(true);
    expect(
      uploadClientPayloadSchema.safeParse({
        attachmentId: "../escape",
        chunkIndex: 1,
      }).success,
    ).toBe(false);
  });
});
