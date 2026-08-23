export const APP_CONFIG = {
  maxMembers: 3,
  maxRoomLifetimeDays: 150,
  maxTextLength: 10_000,
  maxFileBytes: 100 * 1024 * 1024,
  maxVoiceBytes: 25 * 1024 * 1024,
  maxVoiceSeconds: 600,
  historyPageSize: 50,
  cryptoProtocolVersion: 1,
  /** Plaintext bytes per encrypted attachment chunk. */
  attachmentChunkBytes: 3 * 1024 * 1024,
  /** Concurrent chunk uploads/downloads per attachment. */
  attachmentParallelism: 3,
  minPasswordLength: 10,
  maxPasswordLength: 256,
  roomNameMinLength: 1,
  roomNameMaxLength: 50,
  displayNameMinLength: 2,
  displayNameMaxLength: 24,
  /** Maximum ciphertext size (bytes, before base64) accepted for one message. */
  maxMessageCiphertextBytes: 64 * 1024,
  /** Maximum encrypted box size for names (room name / display name). */
  maxNameCiphertextBytes: 1024,
  /**
   * Session cookies live as long as the room (capped by this ceiling).
   * Anything shorter would orphan a member's slot when the cookie died
   * before the room did; the password remains the real credential and
   * sessions stay revocable via sessionVersion / token hash.
   */
  sessionMaxAgeSeconds: 150 * 24 * 60 * 60,
  unlockTokenMaxAgeSeconds: 5 * 60,
} as const;

export const EXPIRATION_PRESETS = {
  "1h": 60 * 60,
  "12h": 12 * 60 * 60,
  "1d": 24 * 60 * 60,
  "3d": 3 * 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "14d": 14 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
  "60d": 60 * 24 * 60 * 60,
  "90d": 90 * 24 * 60 * 60,
  "150d": 150 * 24 * 60 * 60,
} as const;

export type ExpirationPreset = keyof typeof EXPIRATION_PRESETS;

export const EXPIRATION_LABELS: Record<ExpirationPreset, string> = {
  "1h": "1 hour",
  "12h": "12 hours",
  "1d": "1 day",
  "3d": "3 days",
  "7d": "7 days",
  "14d": "14 days",
  "30d": "30 days",
  "60d": "60 days",
  "90d": "90 days",
  "150d": "150 days",
};

export const DEFAULT_KDF_PARAMS = {
  algorithm: "argon2id",
  memoryKiB: 65536,
  iterations: 3,
  parallelism: 1,
} as const;

/** MIME types that may be previewed inline. Everything else is download-only. */
export const INLINE_PREVIEW_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "video/mp4",
  "video/webm",
  "audio/mpeg",
  "audio/mp3",
  "audio/wav",
  "audio/ogg",
  "audio/webm",
  "audio/mp4",
  "audio/x-m4a",
  "audio/aac",
]);
