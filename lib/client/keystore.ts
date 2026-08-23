"use client";

/**
 * Per-tab, memory-only key storage. Keys are never written to localStorage,
 * IndexedDB or cookies: a page refresh intentionally requires re-entering the
 * room password. Only the HttpOnly membership cookie persists.
 */

export interface RoomKeys {
  /** Password-derived key-encryption key. */
  kek: CryptoKey;
  /** Derived auth key (base64url) — re-sent on unlock-requiring calls. */
  authKeyB64: string;
  cryptoVersion: number;
  currentEpoch: number;
  /** Unwrapped random epoch keys, both as CryptoKey and raw bytes (HKDF input). */
  epochKeys: Map<number, { key: CryptoKey; raw: Uint8Array }>;
}

const store = new Map<string, RoomKeys>();

export function getRoomKeys(roomId: string): RoomKeys | null {
  return store.get(roomId) ?? null;
}

export function setRoomKeys(roomId: string, keys: RoomKeys): void {
  store.set(roomId, keys);
}

export function clearRoomKeys(roomId: string): void {
  store.delete(roomId);
}

export function getEpochKey(
  roomId: string,
  epoch: number,
): { key: CryptoKey; raw: Uint8Array } | null {
  return store.get(roomId)?.epochKeys.get(epoch) ?? null;
}

export function getCurrentEpochKey(
  roomId: string,
): { epoch: number; key: CryptoKey; raw: Uint8Array } | null {
  const keys = store.get(roomId);
  if (!keys) return null;
  const entry = keys.epochKeys.get(keys.currentEpoch);
  if (!entry) return null;
  return { epoch: keys.currentEpoch, ...entry };
}
