import { EXPIRATION_PRESETS, type ExpirationPreset } from "@/lib/config";
import type { RoomMeta } from "@/types/room";
import { getStore, StoreConflictError } from "./blob";
import { ApiError } from "./http";
import {
  expiryPath,
  filesPrefix,
  lockPath,
  messagesPrefix,
  metaPath,
  roomPrefix,
} from "./paths";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** How long a held lock is considered live before it may be stolen. */
const LOCK_STALE_MS = 10_000;

export interface LoadedRoom {
  meta: RoomMeta;
  etag: string;
}

/** The server always computes expiry itself from a fixed preset. */
export function computeExpiresAt(preset: ExpirationPreset, from = new Date()) {
  const seconds = EXPIRATION_PRESETS[preset];
  return new Date(from.getTime() + seconds * 1000);
}

export function isRoomExpired(meta: RoomMeta, now = new Date()): boolean {
  return new Date(meta.expiresAt).getTime() <= now.getTime();
}

export async function loadRoom(roomId: string): Promise<LoadedRoom | null> {
  const result = await getStore().readJson<RoomMeta>(metaPath(roomId));
  if (!result) return null;
  return { meta: result.data, etag: result.etag };
}

/**
 * Loads a room and enforces the hard expiry rule: from the second the room
 * expires every endpoint answers 410 regardless of whether the cleanup cron
 * has physically deleted anything yet.
 */
export async function requireLiveRoom(roomId: string): Promise<LoadedRoom> {
  const loaded = await loadRoom(roomId);
  if (!loaded) throw new ApiError(404, "room_not_found");
  if (isRoomExpired(loaded.meta)) throw new ApiError(410, "room_expired");
  return loaded;
}

/**
 * Serialized update of room metadata. Vercel Blob's conditional (ifMatch)
 * writes are unreliable in this environment, but its create-only writes are
 * atomic, so we serialize updates with a short-lived create-only lock instead
 * of an ETag compare-and-swap. The mutation callback may throw ApiError to
 * abort. An orphaned lock (from a crashed request) is stolen after it goes
 * stale so a room can never wedge permanently.
 */
export async function updateRoomMeta(
  roomId: string,
  mutate: (meta: RoomMeta) => RoomMeta | Promise<RoomMeta>,
  maxRetries = 25,
): Promise<RoomMeta> {
  const store = getStore();
  const lock = lockPath(roomId);

  let held = false;
  for (let attempt = 0; attempt <= maxRetries && !held; attempt++) {
    try {
      await store.writeJson(lock, { at: Date.now() }, { createOnly: true });
      held = true;
    } catch (error) {
      if (!(error instanceof StoreConflictError)) throw error;
      // Steal a lock left behind by a crashed request.
      const current = await store.readJson<{ at: number }>(lock);
      if (!current || Date.now() - current.data.at > LOCK_STALE_MS) {
        await store.del([lock]);
        continue;
      }
      await sleep(60 + Math.floor(Math.random() * 90));
    }
  }
  if (!held) throw new ApiError(409, "conflict");

  try {
    const loaded = await store.readJson<RoomMeta>(metaPath(roomId));
    if (!loaded) throw new ApiError(404, "room_not_found");
    if (isRoomExpired(loaded.data)) throw new ApiError(410, "room_expired");
    const next = await mutate(structuredClone(loaded.data));
    next.version = loaded.data.version + 1;
    // Plain overwrite is safe: the lock guarantees we are the only writer.
    await store.writeJson(metaPath(roomId), next);
    return next;
  } finally {
    await store.del([lock]).catch(() => {});
  }
}

/**
 * Persists a new room with a create-only write: an existing pathname is a
 * collision and is rejected so the client retries with a fresh random ID.
 */
export async function persistNewRoom(meta: RoomMeta): Promise<RoomMeta> {
  const store = getStore();
  try {
    await store.writeJson(metaPath(meta.roomId), meta, { createOnly: true });
  } catch (error) {
    if (error instanceof StoreConflictError) {
      throw new ApiError(409, "room_exists");
    }
    throw error;
  }
  // Expiry index for the cleanup cron. Content is minimal on purpose.
  await store.writeJson(expiryPath(meta.roomId, new Date(meta.expiresAt)), {
    roomId: meta.roomId,
    expiresAt: meta.expiresAt,
  });
  return meta;
}

/** Deletes every object of a room, batch by batch (idempotent). */
export async function deleteRoomData(roomId: string): Promise<void> {
  const store = getStore();
  // Delete the meta first so the room instantly stops resolving even if the
  // rest of the cleanup is interrupted; a later run can finish the orphans.
  const loaded = await loadRoom(roomId);
  await store.del([metaPath(roomId)]);
  await deletePrefix(messagesPrefix(roomId));
  await deletePrefix(filesPrefix(roomId));
  await deletePrefix(roomPrefix(roomId));
  if (loaded) {
    await store.del([expiryPath(roomId, new Date(loaded.meta.expiresAt))]);
  }
}

/**
 * Deletes all objects under a prefix, batch by batch. Each round lists from
 * the start (deletion invalidates cursors) until the prefix is empty, with a
 * bounded loop as a safety net. Never accumulates the full object list in
 * memory.
 */
export async function deletePrefix(prefix: string): Promise<void> {
  const store = getStore();
  for (let i = 0; i < 1000; i++) {
    const page = await store.list(prefix, { limit: 500 });
    if (page.blobs.length === 0) return;
    await store.del(page.blobs.map((b) => b.pathname));
    if (!page.hasMore) return;
  }
}
