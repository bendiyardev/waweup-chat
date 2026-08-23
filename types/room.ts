import type { EncryptedBox, RoomCryptoMeta } from "./crypto";

export type MemberRole = "owner" | "member";

export interface RoomMember {
  memberId: string;
  role: MemberRole;
  /** base64url SHA-256 of the member's bearer token. */
  tokenHash: string;
  /** Display name, encrypted client-side with the epoch key. */
  encryptedDisplayName: EncryptedBox | null;
  /** Epoch the display name was encrypted with. */
  displayNameEpoch: number | null;
  joinedAt: string;
  /** Bumped to revoke every session of this member. */
  sessionVersion: number;
  /**
   * Keyed HMAC fingerprint of the IP the member joined from. Never a raw IP.
   * Used only when the owner bans a member together with their IP.
   */
  ipHmac: string;
}

export interface RoomMeta {
  schemaVersion: 1;
  roomId: string;
  createdAt: string;
  expiresAt: string;
  encryptedRoomName: EncryptedBox;
  /** Epoch the room name was encrypted with. */
  roomNameEpoch: number;
  crypto: RoomCryptoMeta;
  members: RoomMember[];
  locked: boolean;
  /** Token hashes of banned members (prevents rejoin with an old token). */
  bannedTokenHashes: string[];
  /** HMAC-SHA-256 fingerprints of banned IPs. Raw IPs are never stored. */
  bannedIpHmacs: string[];
  /** base64url SHA-256 of the owner recovery key. */
  ownerRecoveryHash: string;
  /** Monotonic counter, informational (ETag is the real CAS token). */
  version: number;
}

/** Pre-auth information exposed by GET /api/rooms/[roomId] without a session. */
export interface RoomPublicInfo {
  roomId: string;
  protocolVersion: number;
  salt: string;
  kdf: RoomCryptoMeta["kdf"];
  cryptoVersion: number;
  locked: boolean;
  full: boolean;
  expiresAt: string;
}

/** Crypto material returned after a successful unlock or to a valid session. */
export interface RoomMaterial {
  encryptedRoomName: EncryptedBox;
  roomNameEpoch: number;
  currentEpoch: number;
  epochs: { epoch: number; wrappedKey: EncryptedBox }[];
  cryptoVersion: number;
  members: {
    memberId: string;
    role: MemberRole;
    encryptedDisplayName: EncryptedBox | null;
    displayNameEpoch: number | null;
    joinedAt: string;
  }[];
  expiresAt: string;
}

export interface SessionInfo {
  memberId: string;
  role: MemberRole;
  hasDisplayName: boolean;
}
