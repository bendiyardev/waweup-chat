import { randomBytes, toB64Url } from "./encoding";

/** Crockford base32 alphabet used by ULID. */
const ULID_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

let lastUlidTime = 0;
let lastUlidRandom: number[] = [];

/**
 * Generates a ULID: 48-bit millisecond timestamp + 80 bits of randomness,
 * lexicographically sortable. Monotonic within the same millisecond so two
 * messages sent back-to-back keep their order.
 */
export function generateUlid(now = Date.now()): string {
  let random: number[];
  if (now === lastUlidTime && lastUlidRandom.length === 16) {
    // Increment the previous randomness to stay monotonic.
    random = [...lastUlidRandom];
    for (let i = 15; i >= 0; i--) {
      const value = random[i] ?? 0;
      if (value < 31) {
        random[i] = value + 1;
        break;
      }
      random[i] = 0;
    }
  } else {
    const bytes = randomBytes(16);
    random = Array.from(bytes, (b) => b % 32);
  }
  lastUlidTime = now;
  lastUlidRandom = random;

  let time = "";
  let ms = now;
  for (let i = 0; i < 10; i++) {
    time = ULID_ALPHABET[ms % 32] + time;
    ms = Math.floor(ms / 32);
  }
  const rand = random.map((v) => ULID_ALPHABET[v]).join("");
  return time + rand;
}

export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * Maps a ULID to its lexicographic inverse. Storing messages under the
 * inverted key makes an ascending blob listing return newest-first, which is
 * what a chat history needs (Vercel Blob can only list ascending).
 */
export function toDescendingKey(ulid: string): string {
  let out = "";
  for (const ch of ulid) {
    const idx = ULID_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error("Invalid ULID character");
    out += ULID_ALPHABET[31 - idx];
  }
  return out;
}

export function fromDescendingKey(key: string): string {
  return toDescendingKey(key);
}

/** 192-bit random, base64url — unguessable room IDs. */
export function generateRoomId(): string {
  return toB64Url(randomBytes(24));
}

export const ROOM_ID_REGEX = /^[A-Za-z0-9_-]{32}$/;

export function generateMemberId(): string {
  return toB64Url(randomBytes(12));
}

export const MEMBER_ID_REGEX = /^[A-Za-z0-9_-]{16}$/;

export function generateAttachmentId(): string {
  return toB64Url(randomBytes(12));
}

export const ATTACHMENT_ID_REGEX = /^[A-Za-z0-9_-]{16}$/;

/** 256-bit member bearer token. */
export function generateMemberToken(): string {
  return toB64Url(randomBytes(32));
}

/** 256-bit owner recovery key. */
export function generateRecoveryKey(): string {
  return toB64Url(randomBytes(32));
}
