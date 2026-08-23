import { z } from "zod";
import { APP_CONFIG, EXPIRATION_PRESETS } from "@/lib/config";
import {
  ATTACHMENT_ID_REGEX,
  MEMBER_ID_REGEX,
  ULID_REGEX,
} from "@/lib/crypto/ids";
import { MESSAGE_KINDS } from "@/types/message";

const B64URL = /^[A-Za-z0-9_-]+$/;

const b64url = (min: number, max: number) =>
  z.string().min(min).max(max).regex(B64URL);

/** 12-byte IV → 16 base64url chars. */
const ivSchema = b64url(16, 16);

/** 32-byte value → 43 base64url chars. */
const key32Schema = b64url(43, 43);

const nameBoxSchema = z
  .object({
    iv: ivSchema,
    ct: b64url(1, Math.ceil((APP_CONFIG.maxNameCiphertextBytes * 4) / 3)),
  })
  .strict();

const wrappedKeySchema = z
  .object({
    iv: ivSchema,
    // 32-byte key + 16-byte tag = 48 bytes → 64 chars.
    ct: b64url(1, 128),
  })
  .strict();

export const kdfParamsSchema = z
  .object({
    algorithm: z.literal("argon2id"),
    memoryKiB: z.number().int().min(8192).max(262144),
    iterations: z.number().int().min(1).max(10),
    parallelism: z.number().int().min(1).max(4),
  })
  .strict();

export const expirationPresetSchema = z.enum(
  Object.keys(EXPIRATION_PRESETS) as [string, ...string[]],
);

export const createRoomSchema = z
  .object({
    roomId: b64url(32, 32),
    encryptedRoomName: nameBoxSchema,
    salt: b64url(22, 22),
    kdf: kdfParamsSchema,
    authKey: key32Schema,
    wrappedEpochKey: wrappedKeySchema,
    recoveryKeyHash: key32Schema,
    expiresPreset: expirationPresetSchema,
  })
  .strict();

export const unlockSchema = z
  .object({
    authKey: key32Schema,
    recoveryKey: key32Schema.optional(),
  })
  .strict();

export const joinSchema = z
  .object({
    unlockToken: z.string().min(1).max(2048).optional(),
    encryptedDisplayName: nameBoxSchema,
    displayNameEpoch: z.number().int().min(1).max(100_000),
  })
  .strict();

const messageCtMaxChars = Math.ceil(
  (APP_CONFIG.maxMessageCiphertextBytes * 4) / 3,
);

export const sendMessageSchema = z
  .object({
    messageId: z.string().regex(ULID_REGEX),
    kind: z.enum(MESSAGE_KINDS),
    keyEpoch: z.number().int().min(1).max(100_000),
    iv: ivSchema,
    ct: b64url(1, messageCtMaxChars),
    attachmentId: z.string().regex(ATTACHMENT_ID_REGEX).optional(),
  })
  .strict();

export const rotateKeySchema = z
  .object({
    epoch: z.number().int().min(2).max(100_000),
    wrappedKey: wrappedKeySchema,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    salt: b64url(22, 22),
    kdf: kdfParamsSchema,
    authKey: key32Schema,
    epochs: z
      .array(
        z
          .object({
            epoch: z.number().int().min(1).max(100_000),
            wrappedKey: wrappedKeySchema,
          })
          .strict(),
      )
      .min(1)
      .max(200),
    currentEpoch: z.number().int().min(1).max(100_000),
  })
  .strict();

export const banSchema = z
  .object({
    banIp: z.boolean().optional().default(false),
  })
  .strict();

export const memberIdSchema = z.string().regex(MEMBER_ID_REGEX);

export const uploadClientPayloadSchema = z
  .object({
    attachmentId: z.string().regex(ATTACHMENT_ID_REGEX),
    chunkIndex: z.number().int().min(1).max(100_000),
    voice: z.boolean().optional().default(false),
  })
  .strict();
