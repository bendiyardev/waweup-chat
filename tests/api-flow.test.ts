import { beforeEach, describe, expect, it } from "vitest";
import { POST as createRoomRoute } from "@/app/api/rooms/route";
import {
  DELETE as destroyRoomRoute,
  GET as getRoomRoute,
} from "@/app/api/rooms/[roomId]/route";
import { POST as unlockRoute } from "@/app/api/rooms/[roomId]/unlock/route";
import { POST as joinRoute } from "@/app/api/rooms/[roomId]/join/route";
import {
  DELETE as clearMessagesRoute,
  GET as listMessagesRoute,
  POST as sendMessageRoute,
} from "@/app/api/rooms/[roomId]/messages/route";
import { DELETE as deleteMessageRoute } from "@/app/api/rooms/[roomId]/messages/[messageId]/route";
import { POST as banMemberRoute } from "@/app/api/rooms/[roomId]/members/[memberId]/ban/route";
import { POST as removeMemberRoute } from "@/app/api/rooms/[roomId]/members/[memberId]/remove/route";
import { GET as cronCleanupRoute } from "@/app/api/cron/cleanup/route";
import { importAesKey } from "@/lib/crypto/aes";
import { deriveMasterKey } from "@/lib/crypto/argon";
import {
  fromB64Url,
  randomBytes,
  sha256B64Url,
  toB64Url,
} from "@/lib/crypto/encoding";
import { generateRoomId, generateUlid } from "@/lib/crypto/ids";
import { deriveRoomKeys, unwrapEpochKey, wrapEpochKey } from "@/lib/crypto/keys";
import {
  decryptMessagePayload,
  encryptMemberName,
  encryptMessagePayload,
  encryptRoomName,
} from "@/lib/crypto/protocol";
import { getStore, resetMemoryStore } from "@/lib/server/blob";
import { serverEnv } from "@/lib/server/env";
import { metaPath } from "@/lib/server/paths";
import { resetRateLimiter } from "@/lib/server/ratelimit";
import type { KdfParams } from "@/types/crypto";
import type { MessageEnvelope } from "@/types/message";
import type { RoomMeta } from "@/types/room";

const KDF: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
};

function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) } as never;
}

function cookieFrom(res: Response): string {
  const setCookies = res.headers.getSetCookie();
  return setCookies.map((c) => c.split(";")[0]).join("; ");
}

async function deriveCreds(password: string, saltB64: string) {
  const master = await deriveMasterKey(password, fromB64Url(saltB64), KDF);
  return deriveRoomKeys(master);
}

interface TestOwner {
  roomId: string;
  cookie: string;
  kek: CryptoKey;
  authKeyB64: string;
  epochKey: CryptoKey;
  epochKeyRaw: Uint8Array;
  recoveryKey: string;
}

async function createRoom(
  password = "hunter2-hunter2",
  name = "test room",
  preset = "7d",
): Promise<TestOwner> {
  const salt = toB64Url(randomBytes(16));
  const { kek, authKeyB64 } = await deriveCreds(password, salt);
  const epochKeyRaw = randomBytes(32);
  const epochKey = await importAesKey(epochKeyRaw);
  const roomId = generateRoomId();
  const recoveryKey = toB64Url(randomBytes(32));
  const body = {
    roomId,
    encryptedRoomName: await encryptRoomName(epochKey, name, roomId, 1),
    salt,
    kdf: KDF,
    authKey: authKeyB64,
    wrappedEpochKey: await wrapEpochKey(kek, epochKeyRaw, roomId, 1),
    recoveryKeyHash: await sha256B64Url(fromB64Url(recoveryKey)),
    expiresPreset: preset,
  };
  const res = await createRoomRoute(
    new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
  expect(res.status).toBe(201);
  return {
    roomId,
    cookie: cookieFrom(res),
    kek,
    authKeyB64,
    epochKey,
    epochKeyRaw,
    recoveryKey,
  };
}

async function unlock(roomId: string, authKeyB64: string, cookie = "") {
  return unlockRoute(
    new Request(`http://localhost/api/rooms/${roomId}/unlock`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ authKey: authKeyB64 }),
    }),
    ctx({ roomId }),
  );
}

async function join(
  roomId: string,
  epochKey: CryptoKey,
  displayName: string,
  options: { unlockToken?: string; cookie?: string } = {},
) {
  const encryptedDisplayName = await encryptMemberName(
    epochKey,
    displayName,
    roomId,
    1,
  );
  return joinRoute(
    new Request(`http://localhost/api/rooms/${roomId}/join`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: options.cookie ?? "",
      },
      body: JSON.stringify({
        ...(options.unlockToken ? { unlockToken: options.unlockToken } : {}),
        encryptedDisplayName,
        displayNameEpoch: 1,
      }),
    }),
    ctx({ roomId }),
  );
}

async function sendText(
  owner: TestOwner,
  cookie: string,
  text: string,
  displayName: string,
) {
  const messageId = generateUlid();
  const box = await encryptMessagePayload(
    owner.epochKey,
    { displayName, text },
    owner.roomId,
    messageId,
    "text",
    1,
  );
  const res = await sendMessageRoute(
    new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        messageId,
        kind: "text",
        keyEpoch: 1,
        iv: box.iv,
        ct: box.ct,
      }),
    }),
    ctx({ roomId: owner.roomId }),
  );
  return { res, messageId };
}

beforeEach(() => {
  resetMemoryStore();
  resetRateLimiter();
});

describe("room lifecycle over the real API routes", () => {
  it("creates a room and exposes only public crypto parameters pre-auth", async () => {
    const owner = await createRoom();
    const res = await getRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`),
      ctx({ roomId: owner.roomId }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.session).toBeNull();
    expect(body.room.salt).toBeDefined();
    expect(body.material).toBeUndefined();
    expect(JSON.stringify(body)).not.toContain("verifierHash");
  });

  it("rejects a wrong password and accepts the right one", async () => {
    const owner = await createRoom("correct-password-1");
    const { authKeyB64: wrongKey } = await deriveCreds(
      "wrong-password-1",
      (
        await (
          await getRoomRoute(
            new Request(`http://localhost/api/rooms/${owner.roomId}`),
            ctx({ roomId: owner.roomId }),
          )
        ).json()
      ).room.salt,
    );
    const bad = await unlock(owner.roomId, wrongKey);
    expect(bad.status).toBe(401);
    expect((await bad.json()).error.code).toBe("invalid_password");

    const good = await unlock(owner.roomId, owner.authKeyB64);
    expect(good.status).toBe(200);
    const body = await good.json();
    expect(body.unlockToken).toBeDefined();
    expect(body.material.epochs).toHaveLength(1);
    // The wrapped key must be openable by the password-derived KEK.
    const raw = await unwrapEpochKey(
      owner.kek,
      body.material.epochs[0].wrappedKey,
      owner.roomId,
      1,
    );
    expect(toB64Url(raw)).toBe(toB64Url(owner.epochKeyRaw));
  });

  it("lets members join up to the cap of 3 and rejects the fourth", async () => {
    const owner = await createRoom();
    // Owner sets their name using the session cookie.
    const ownerJoin = await join(owner.roomId, owner.epochKey, "Diyar", {
      cookie: owner.cookie,
    });
    expect(ownerJoin.status).toBe(200);

    const cookies: string[] = [];
    for (const name of ["Ahmet", "Mehmet"]) {
      const unlocked = await unlock(owner.roomId, owner.authKeyB64);
      const { unlockToken } = await unlocked.json();
      const joined = await join(owner.roomId, owner.epochKey, name, {
        unlockToken,
      });
      expect(joined.status).toBe(201);
      cookies.push(cookieFrom(joined));
    }

    // Fourth participant: password correct, but the room is full.
    const fourth = await unlock(owner.roomId, owner.authKeyB64);
    const fourthBody = await fourth.json();
    expect(fourthBody.full).toBe(true);
    expect(fourthBody.unlockToken).toBeUndefined();
    expect(fourthBody.material).toBeUndefined();
  });

  it("sends, lists, reloads and deletes encrypted messages", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });

    const first = await sendText(owner, owner.cookie, "hello", "Diyar");
    expect(first.res.status).toBe(201);
    const second = await sendText(owner, owner.cookie, "world", "Diyar");
    expect(second.res.status).toBe(201);

    const list = await listMessagesRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(list.status).toBe(200);
    const listBody = (await list.json()) as {
      messages: MessageEnvelope[];
    };
    expect(listBody.messages).toHaveLength(2);
    // Newest first; ciphertext only; decryptable by key holders.
    expect(listBody.messages[0]!.messageId).toBe(second.messageId);
    expect(JSON.stringify(listBody)).not.toContain("hello");
    const payload = await decryptMessagePayload(
      owner.epochKey,
      { iv: listBody.messages[1]!.iv, ct: listBody.messages[1]!.ct },
      owner.roomId,
      first.messageId,
      "text",
      1,
    );
    expect(payload.text).toBe("hello");

    // Duplicate messageId is rejected (immutable objects).
    const dupBox = await encryptMessagePayload(
      owner.epochKey,
      { displayName: "Diyar", text: "dup" },
      owner.roomId,
      first.messageId,
      "text",
      1,
    );
    const dup = await sendMessageRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          messageId: first.messageId,
          kind: "text",
          keyEpoch: 1,
          iv: dupBox.iv,
          ct: dupBox.ct,
        }),
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(dup.status).toBe(409);

    const del = await deleteMessageRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/messages/${first.messageId}`,
        { method: "DELETE", headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId, messageId: first.messageId }),
    );
    expect(del.status).toBe(200);

    const afterDelete = await listMessagesRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect((await afterDelete.json()).messages).toHaveLength(1);
  });

  it("enforces owner-only admin actions and bans", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    const unlocked = await unlock(owner.roomId, owner.authKeyB64);
    const { unlockToken } = await unlocked.json();
    const joined = await join(owner.roomId, owner.epochKey, "Ahmet", {
      unlockToken,
    });
    const memberCookie = cookieFrom(joined);
    const { memberId } = await joined.json();

    // A regular member cannot ban.
    const forbidden = await banMemberRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/members/${memberId}/ban`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: memberCookie },
          body: JSON.stringify({ banIp: false }),
        },
      ),
      ctx({ roomId: owner.roomId, memberId }),
    );
    expect(forbidden.status).toBe(403);

    // The owner can.
    const banned = await banMemberRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/members/${memberId}/ban`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: owner.cookie },
          body: JSON.stringify({ banIp: true }),
        },
      ),
      ctx({ roomId: owner.roomId, memberId }),
    );
    expect(banned.status).toBe(200);

    // The banned member's session is dead.
    const sendAfterBan = await sendText(
      owner,
      memberCookie,
      "still here?",
      "Ahmet",
    );
    expect(sendAfterBan.res.status).toBe(401);

    // Rejoining from the banned IP fingerprint is blocked.
    const reUnlock = await unlock(owner.roomId, owner.authKeyB64);
    const reBody = await reUnlock.json();
    const rejoin = await join(owner.roomId, owner.epochKey, "Ahmet2", {
      unlockToken: reBody.unlockToken,
    });
    expect(rejoin.status).toBe(403);
    expect((await rejoin.json()).error.code).toBe("banned");
  });

  it("removes a member and frees the slot", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    const unlocked = await unlock(owner.roomId, owner.authKeyB64);
    const { unlockToken } = await unlocked.json();
    const joined = await join(owner.roomId, owner.epochKey, "Ahmet", {
      unlockToken,
    });
    const { memberId } = await joined.json();

    const removed = await removeMemberRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/members/${memberId}/remove`,
        { method: "POST", headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId, memberId }),
    );
    expect(removed.status).toBe(200);

    const state = await getRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    const stateBody = await state.json();
    expect(stateBody.material.members).toHaveLength(1);
  });

  it("clears all messages (owner only)", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    await sendText(owner, owner.cookie, "a", "Diyar");
    await sendText(owner, owner.cookie, "b", "Diyar");
    const cleared = await clearMessagesRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        method: "DELETE",
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(cleared.status).toBe(200);
    const list = await listMessagesRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect((await list.json()).messages).toHaveLength(0);
  });

  it("returns 410 for every endpoint the second a room expires", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    // Force expiry directly in storage.
    const store = getStore();
    const loaded = await store.readJson<RoomMeta>(metaPath(owner.roomId));
    await store.writeJson(metaPath(owner.roomId), {
      ...loaded!.data,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const get = await getRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(get.status).toBe(410);

    const send = await sendText(owner, owner.cookie, "late", "Diyar");
    expect(send.res.status).toBe(410);

    const unlockRes = await unlock(owner.roomId, owner.authKeyB64);
    expect(unlockRes.status).toBe(410);
  });

  it("destroys a room permanently (owner only)", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    await sendText(owner, owner.cookie, "bye", "Diyar");

    const destroyed = await destroyRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`, {
        method: "DELETE",
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(destroyed.status).toBe(200);

    const after = await getRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`),
      ctx({ roomId: owner.roomId }),
    );
    expect(after.status).toBe(404);
  });

  it("cron cleanup deletes expired rooms via the expiry index", async () => {
    const owner = await createRoom("cleanup-password-1", "cleanup", "1h");
    const store = getStore();
    const loaded = await store.readJson<RoomMeta>(metaPath(owner.roomId));
    const past = new Date(Date.now() - 24 * 3600_000);
    await store.writeJson(metaPath(owner.roomId), {
      ...loaded!.data,
      expiresAt: past.toISOString(),
    });
    // Re-home the expiry index entry into a past date folder.
    await store.del([
      `expiry/${loaded!.data.expiresAt.slice(0, 10)}/${owner.roomId}.json`,
    ]);
    await store.writeJson(
      `expiry/${past.toISOString().slice(0, 10)}/${owner.roomId}.json`,
      { roomId: owner.roomId, expiresAt: past.toISOString() },
    );

    const unauthorized = await cronCleanupRoute(
      new Request("http://localhost/api/cron/cleanup"),
    );
    expect(unauthorized.status).toBe(401);

    const res = await cronCleanupRoute(
      new Request("http://localhost/api/cron/cleanup", {
        headers: { authorization: `Bearer ${serverEnv().CRON_SECRET}` },
      }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deletedRooms).toBe(1);
    expect(await store.readJson(metaPath(owner.roomId))).toBeNull();
  });

  it("rejects cross-origin mutations", async () => {
    const owner = await createRoom();
    const res = await sendMessageRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: owner.cookie,
          origin: "https://evil.example",
          host: "localhost",
        },
        body: JSON.stringify({}),
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(res.status).toBe(403);
  });
});
