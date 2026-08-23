import { beforeEach, describe, expect, it } from "vitest";
import { EXPIRATION_PRESETS } from "@/lib/config";
import {
  authenticateMember,
  sessionCookieName,
  sha256B64UrlSync,
  signSession,
  signUnlockToken,
  verifyUnlockToken,
} from "@/lib/server/auth";
import { getStore, resetMemoryStore, StoreConflictError } from "@/lib/server/blob";
import { metaPath } from "@/lib/server/paths";
import {
  computeExpiresAt,
  isRoomExpired,
  updateRoomMeta,
} from "@/lib/server/rooms";
import type { RoomMeta } from "@/types/room";

function makeMeta(overrides: Partial<RoomMeta> = {}): RoomMeta {
  return {
    schemaVersion: 1,
    roomId: "r".repeat(32),
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3600_000).toISOString(),
    encryptedRoomName: { iv: "a".repeat(16), ct: "b".repeat(24) },
    roomNameEpoch: 1,
    crypto: {
      protocolVersion: 1,
      salt: "s".repeat(22),
      kdf: { algorithm: "argon2id", memoryKiB: 8192, iterations: 1, parallelism: 1 },
      verifierHash: sha256B64UrlSync("verifier"),
      currentEpoch: 1,
      epochs: [
        {
          epoch: 1,
          wrappedKey: { iv: "a".repeat(16), ct: "c".repeat(64) },
          createdAt: new Date().toISOString(),
        },
      ],
      cryptoVersion: 1,
    },
    members: [
      {
        memberId: "m".repeat(16),
        role: "owner",
        tokenHash: sha256B64UrlSync("owner-token"),
        encryptedDisplayName: null,
        displayNameEpoch: null,
        joinedAt: new Date().toISOString(),
        sessionVersion: 1,
        ipHmac: "x",
      },
    ],
    locked: false,
    bannedTokenHashes: [],
    bannedIpHmacs: [],
    ownerRecoveryHash: sha256B64UrlSync("recovery"),
    version: 1,
    ...overrides,
  };
}

beforeEach(() => {
  resetMemoryStore();
});

describe("expiration", () => {
  it("computes server-side expiry from presets", () => {
    const from = new Date("2026-01-01T00:00:00Z");
    const result = computeExpiresAt("7d", from);
    expect(result.getTime() - from.getTime()).toBe(
      EXPIRATION_PRESETS["7d"] * 1000,
    );
  });

  it("treats the exact expiry instant as expired", () => {
    const meta = makeMeta({ expiresAt: new Date().toISOString() });
    expect(isRoomExpired(meta)).toBe(true);
    const live = makeMeta();
    expect(isRoomExpired(live)).toBe(false);
  });
});

describe("sessions", () => {
  it("authenticates a valid session against room metadata", async () => {
    const meta = makeMeta({
      members: [
        {
          ...makeMeta().members[0]!,
          tokenHash: sha256B64UrlSync("tok-1"),
        },
      ],
    });
    const { token } = await signSession(
      {
        rid: meta.roomId,
        mid: meta.members[0]!.memberId,
        tok: "tok-1",
        sv: 1,
      },
      new Date(meta.expiresAt),
    );
    const req = new Request("http://localhost/x", {
      headers: { cookie: `${sessionCookieName(meta.roomId)}=${token}` },
    });
    const authed = await authenticateMember(req, meta);
    expect(authed?.member.memberId).toBe(meta.members[0]!.memberId);
  });

  it("rejects a revoked session version", async () => {
    const meta = makeMeta({
      members: [
        {
          ...makeMeta().members[0]!,
          tokenHash: sha256B64UrlSync("tok-1"),
          sessionVersion: 2,
        },
      ],
    });
    const { token } = await signSession(
      {
        rid: meta.roomId,
        mid: meta.members[0]!.memberId,
        tok: "tok-1",
        sv: 1,
      },
      new Date(meta.expiresAt),
    );
    const req = new Request("http://localhost/x", {
      headers: { cookie: `${sessionCookieName(meta.roomId)}=${token}` },
    });
    expect(await authenticateMember(req, meta)).toBeNull();
  });

  it("rejects tampered tokens and wrong rooms", async () => {
    const meta = makeMeta();
    const { token } = await signSession(
      { rid: meta.roomId, mid: "m".repeat(16), tok: "t", sv: 1 },
      new Date(meta.expiresAt),
    );
    const bad = token.slice(0, -3) + "abc";
    const req = new Request("http://localhost/x", {
      headers: { cookie: `${sessionCookieName(meta.roomId)}=${bad}` },
    });
    expect(await authenticateMember(req, meta)).toBeNull();
  });

  it("issues and verifies unlock tokens per room", async () => {
    const token = await signUnlockToken("room-1");
    expect(await verifyUnlockToken(token, "room-1")).toBe(true);
    expect(await verifyUnlockToken(token, "room-2")).toBe(false);
    expect(await verifyUnlockToken("garbage", "room-1")).toBe(false);
  });
});

describe("metadata compare-and-swap", () => {
  it("rejects stale-etag writes and retries via updateRoomMeta", async () => {
    const store = getStore();
    const meta = makeMeta();
    const { etag } = await store.writeJson(metaPath(meta.roomId), meta);

    // A concurrent write invalidates the first etag.
    await store.writeJson(metaPath(meta.roomId), { ...meta, version: 2 });
    await expect(
      store.writeJson(metaPath(meta.roomId), meta, { ifMatch: etag }),
    ).rejects.toThrow(StoreConflictError);

    // updateRoomMeta re-reads and applies on top of the latest version.
    const updated = await updateRoomMeta(meta.roomId, (m) => {
      m.locked = true;
      return m;
    });
    expect(updated.locked).toBe(true);
    expect(updated.version).toBe(3);
  });

  it("create-only writes refuse to overwrite", async () => {
    const store = getStore();
    const meta = makeMeta();
    await store.writeJson(metaPath(meta.roomId), meta, { createOnly: true });
    await expect(
      store.writeJson(metaPath(meta.roomId), meta, { createOnly: true }),
    ).rejects.toThrow(StoreConflictError);
  });
});
