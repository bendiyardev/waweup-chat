import { beforeEach, describe, expect, it } from "vitest";
import { GET as getRoomRoute } from "@/app/api/rooms/[roomId]/route";
import { GET as listMessagesRoute, POST as sendMessageRoute } from "@/app/api/rooms/[roomId]/messages/route";
import { POST as changePasswordRoute } from "@/app/api/rooms/[roomId]/change-password/route";
import { POST as rotateKeyRoute } from "@/app/api/rooms/[roomId]/rotate-key/route";
import { POST as lockRoute } from "@/app/api/rooms/[roomId]/lock/route";
import { POST as unlockRoomRoute } from "@/app/api/rooms/[roomId]/unlock-room/route";
import { POST as removeMemberRoute } from "@/app/api/rooms/[roomId]/members/[memberId]/remove/route";
import { GET as chunkRoute } from "@/app/api/rooms/[roomId]/attachments/[attachmentId]/[chunk]/route";
import { importAesKey } from "@/lib/crypto/aes";
import { randomBytes, toB64Url } from "@/lib/crypto/encoding";
import { generateUlid } from "@/lib/crypto/ids";
import { unwrapEpochKey, wrapEpochKey } from "@/lib/crypto/keys";
import { decryptMessagePayload, encryptMessagePayload } from "@/lib/crypto/protocol";
import { getMemoryStore, resetMemoryStore } from "@/lib/server/blob";
import { chunkPath } from "@/lib/server/paths";
import { testEvents } from "@/lib/server/pusher";
import { resetRateLimiter } from "@/lib/server/ratelimit";
import type { MessageEnvelope } from "@/types/message";
import type { RoomMaterial } from "@/types/room";
import {
  cookieFrom,
  createRoom,
  ctx,
  deriveCreds,
  join,
  KDF,
  sendText,
  unlock,
} from "./room-helpers";

beforeEach(() => {
  resetMemoryStore();
  resetRateLimiter();
  testEvents.length = 0;
});

describe("history pagination and reconciliation", () => {
  it("pages newest-first with a cursor and reconciles with ?after=", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });

    const ids: string[] = [];
    for (let i = 0; i < 55; i++) {
      const { res, messageId } = await sendText(
        owner.roomId,
        owner.epochKey,
        owner.cookie,
        `msg ${i}`,
        "Diyar",
      );
      expect(res.status).toBe(201);
      ids.push(messageId);
    }

    // Page 1: newest 50.
    const page1 = await listMessagesRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    const body1 = (await page1.json()) as {
      messages: MessageEnvelope[];
      cursor: string | null;
      hasMore: boolean;
    };
    expect(body1.messages).toHaveLength(50);
    expect(body1.hasMore).toBe(true);
    expect(body1.cursor).toBeTruthy();
    expect(body1.messages[0]!.messageId).toBe(ids[54]);
    expect(body1.messages[49]!.messageId).toBe(ids[5]);

    // Page 2: the remaining 5, then exhausted.
    const page2 = await listMessagesRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/messages?cursor=${encodeURIComponent(body1.cursor!)}`,
        { headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId }),
    );
    const body2 = (await page2.json()) as {
      messages: MessageEnvelope[];
      hasMore: boolean;
    };
    expect(body2.messages.map((m) => m.messageId)).toEqual(
      [ids[4], ids[3], ids[2], ids[1], ids[0]],
    );
    expect(body2.hasMore).toBe(false);

    // Reconciliation: only messages newer than a given ID.
    const after = await listMessagesRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/messages?after=${ids[52]}`,
        { headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId }),
    );
    const afterBody = (await after.json()) as { messages: MessageEnvelope[] };
    expect(afterBody.messages.map((m) => m.messageId).sort()).toEqual(
      [ids[53], ids[54]].sort(),
    );
  });

  it("announces oversized envelopes by ID only (Pusher 10KB cap)", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });

    const small = await sendText(
      owner.roomId, owner.epochKey, owner.cookie, "short", "Diyar",
    );
    expect(small.res.status).toBe(201);
    const big = await sendText(
      owner.roomId, owner.epochKey, owner.cookie, "x".repeat(9500), "Diyar",
    );
    expect(big.res.status).toBe(201);

    const events = testEvents.filter((e) => e.event === "message-new");
    expect(events).toHaveLength(2);
    const smallEvent = events[0]!.data as { envelope?: MessageEnvelope };
    const bigEvent = events[1]!.data as {
      envelope?: MessageEnvelope;
      messageId?: string;
    };
    expect(smallEvent.envelope?.messageId).toBe(small.messageId);
    expect(bigEvent.envelope).toBeUndefined();
    expect(bigEvent.messageId).toBe(big.messageId);
  });
});

describe("key rotation", () => {
  it("starts a new epoch, enforces epoch bounds, keeps history readable", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    await sendText(owner.roomId, owner.epochKey, owner.cookie, "old", "Diyar");

    // A future epoch is rejected before rotation.
    const early = await sendText(
      owner.roomId, owner.epochKey, owner.cookie, "early", "Diyar", 2,
    );
    expect(early.res.status).toBe(400);

    const epoch2Raw = randomBytes(32);
    const rotated = await rotateKeyRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/rotate-key`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          epoch: 2,
          wrappedKey: await wrapEpochKey(owner.kek, epoch2Raw, owner.roomId, 2),
        }),
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(rotated.status).toBe(200);
    expect((await rotated.json()).currentEpoch).toBe(2);

    // Wrong next epoch conflicts.
    const conflict = await rotateKeyRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/rotate-key`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          epoch: 4,
          wrappedKey: await wrapEpochKey(owner.kek, randomBytes(32), owner.roomId, 4),
        }),
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(conflict.status).toBe(409);

    // Messages under epoch 2 are accepted and decryptable via the new key.
    const epoch2Key = await importAesKey(epoch2Raw);
    const sent = await sendText(
      owner.roomId, epoch2Key, owner.cookie, "new epoch", "Diyar", 2,
    );
    expect(sent.res.status).toBe(201);

    const state = await getRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    const material = (await state.json()).material as RoomMaterial;
    expect(material.currentEpoch).toBe(2);
    expect(material.epochs).toHaveLength(2);
    // Both wrapped keys still open with the password-derived KEK.
    for (const entry of material.epochs) {
      await expect(
        unwrapEpochKey(owner.kek, entry.wrappedKey, owner.roomId, entry.epoch),
      ).resolves.toBeInstanceOf(Uint8Array);
    }
  });
});

describe("password change", () => {
  it("atomically swaps verifier, salt and rewrapped epochs", async () => {
    const owner = await createRoom("old-password-abc");
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    const sent = await sendText(
      owner.roomId, owner.epochKey, owner.cookie, "history", "Diyar",
    );

    const newSalt = toB64Url(randomBytes(16));
    const newCreds = await deriveCreds("new-password-xyz", newSalt);
    const epoch2Raw = randomBytes(32);
    const res = await changePasswordRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/change-password`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: owner.cookie },
          body: JSON.stringify({
            salt: newSalt,
            kdf: KDF,
            authKey: newCreds.authKeyB64,
            epochs: [
              {
                epoch: 1,
                wrappedKey: await wrapEpochKey(
                  newCreds.kek, owner.epochKeyRaw, owner.roomId, 1,
                ),
              },
              {
                epoch: 2,
                wrappedKey: await wrapEpochKey(
                  newCreds.kek, epoch2Raw, owner.roomId, 2,
                ),
              },
            ],
            currentEpoch: 2,
          }),
        },
      ),
      ctx({ roomId: owner.roomId }),
    );
    expect(res.status).toBe(200);

    // Old password no longer unlocks; the new one does.
    const oldUnlock = await unlock(owner.roomId, owner.authKeyB64);
    expect(oldUnlock.status).toBe(401);
    const newUnlock = await unlock(owner.roomId, newCreds.authKeyB64);
    expect(newUnlock.status).toBe(200);
    const material = (await newUnlock.json()).material as RoomMaterial;
    expect(material.currentEpoch).toBe(2);

    // A new-password holder can unwrap epoch 1 and read history.
    const epoch1Entry = material.epochs.find((e) => e.epoch === 1)!;
    const epoch1Raw = await unwrapEpochKey(
      newCreds.kek, epoch1Entry.wrappedKey, owner.roomId, 1,
    );
    const list = await listMessagesRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    const envelope = ((await list.json()).messages as MessageEnvelope[]).find(
      (m) => m.messageId === sent.messageId,
    )!;
    const payload = await decryptMessagePayload(
      await importAesKey(epoch1Raw),
      { iv: envelope.iv, ct: envelope.ct },
      owner.roomId,
      envelope.messageId,
      "text",
      1,
    );
    expect(payload.text).toBe("history");

    // An incomplete epoch set is rejected (history must never break).
    const badChange = await changePasswordRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/change-password`,
        {
          method: "POST",
          headers: { "content-type": "application/json", cookie: owner.cookie },
          body: JSON.stringify({
            salt: toB64Url(randomBytes(16)),
            kdf: KDF,
            authKey: newCreds.authKeyB64,
            epochs: [
              {
                epoch: 3,
                wrappedKey: await wrapEpochKey(
                  newCreds.kek, randomBytes(32), owner.roomId, 3,
                ),
              },
            ],
            currentEpoch: 3,
          }),
        },
      ),
      ctx({ roomId: owner.roomId }),
    );
    expect(badChange.status).toBe(409);
  });
});

describe("locking and leaving", () => {
  it("a locked room refuses new joins but keeps members working", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    const locked = await lockRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/lock`, {
        method: "POST",
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(locked.status).toBe(200);

    // Correct password, but no join path while locked.
    const attempt = await unlock(owner.roomId, owner.authKeyB64);
    const attemptBody = await attempt.json();
    expect(attemptBody.locked).toBe(true);
    expect(attemptBody.unlockToken).toBeUndefined();

    // Existing members still chat.
    const sent = await sendText(
      owner.roomId, owner.epochKey, owner.cookie, "still here", "Diyar",
    );
    expect(sent.res.status).toBe(201);

    // Unlocking the room restores joins.
    await unlockRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/unlock-room`, {
        method: "POST",
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    const retry = await unlock(owner.roomId, owner.authKeyB64);
    expect((await retry.json()).unlockToken).toBeDefined();
  });

  it("a member can leave; the owner cannot be removed", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });
    const unlocked = await unlock(owner.roomId, owner.authKeyB64);
    const { unlockToken } = await unlocked.json();
    const joined = await join(owner.roomId, owner.epochKey, "Ahmet", {
      unlockToken,
    });
    const memberCookie = cookieFrom(joined);
    const { memberId } = await joined.json();

    // Self-leave works.
    const left = await removeMemberRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/members/${memberId}/remove`,
        { method: "POST", headers: { cookie: memberCookie } },
      ),
      ctx({ roomId: owner.roomId, memberId }),
    );
    expect(left.status).toBe(200);

    // The owner cannot be removed, even by themselves.
    const ownerState = await getRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    const ownerId = (await ownerState.json()).session.memberId as string;
    const removeOwner = await removeMemberRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/members/${ownerId}/remove`,
        { method: "POST", headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId, memberId: ownerId }),
    );
    expect(removeOwner.status).toBe(403);
  });
});

describe("owner recovery", () => {
  it("restores owner access with password + recovery key and revokes old sessions", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });

    // Recovery from a cookie-less browser.
    const recovered = await unlock(owner.roomId, owner.authKeyB64, {
      recoveryKey: owner.recoveryKey,
    });
    expect(recovered.status).toBe(200);
    const body = await recovered.json();
    expect(body.recovered).toBe(true);
    expect(body.session.role).toBe("owner");
    const newCookie = cookieFrom(recovered);
    expect(newCookie).toContain("wawe_s_");

    // The previous owner session is revoked.
    const oldState = await getRoomRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}`, {
        headers: { cookie: owner.cookie },
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect((await oldState.json()).session).toBeNull();

    // The recovered session is a working owner session.
    const sent = await sendText(
      owner.roomId, owner.epochKey, newCookie, "recovered", "Diyar",
    );
    expect(sent.res.status).toBe(201);

    // A wrong recovery key is rejected.
    const bad = await unlock(owner.roomId, owner.authKeyB64, {
      recoveryKey: toB64Url(randomBytes(32)),
    });
    expect(bad.status).toBe(401);
  });
});

describe("encrypted attachment chunks", () => {
  it("serves ciphertext only to authenticated members", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });

    const attachmentId = toB64Url(randomBytes(12));
    const cipher = randomBytes(1024);
    await getMemoryStore()!.writeBytesDirect(
      chunkPath(owner.roomId, attachmentId, 1),
      cipher,
    );

    const anonymous = await chunkRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/attachments/${attachmentId}/1`,
      ),
      ctx({ roomId: owner.roomId, attachmentId, chunk: "1" }),
    );
    expect(anonymous.status).toBe(401);

    const authed = await chunkRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/attachments/${attachmentId}/1`,
        { headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId, attachmentId, chunk: "1" }),
    );
    expect(authed.status).toBe(200);
    expect(new Uint8Array(await authed.arrayBuffer())).toEqual(cipher);

    const missing = await chunkRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/attachments/${attachmentId}/2`,
        { headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId, attachmentId, chunk: "2" }),
    );
    expect(missing.status).toBe(404);
  });

  it("deleting an attachment message deletes its cipher chunks", async () => {
    const owner = await createRoom();
    await join(owner.roomId, owner.epochKey, "Diyar", { cookie: owner.cookie });

    const attachmentId = toB64Url(randomBytes(12));
    await getMemoryStore()!.writeBytesDirect(
      chunkPath(owner.roomId, attachmentId, 1),
      randomBytes(64),
    );
    const messageId = generateUlid();
    const box = await encryptMessagePayload(
      owner.epochKey,
      {
        displayName: "Diyar",
        attachment: {
          attachmentId,
          name: "f.bin",
          mime: "application/octet-stream",
          size: 64,
          chunkCount: 1,
          chunkSize: 64,
        },
      },
      owner.roomId,
      messageId,
      "file",
      1,
    );
    const sent = await sendMessageRoute(
      new Request(`http://localhost/api/rooms/${owner.roomId}/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", cookie: owner.cookie },
        body: JSON.stringify({
          messageId,
          kind: "file",
          keyEpoch: 1,
          iv: box.iv,
          ct: box.ct,
          attachmentId,
        }),
      }),
      ctx({ roomId: owner.roomId }),
    );
    expect(sent.status).toBe(201);

    const { DELETE: deleteMessageRoute } = await import(
      "@/app/api/rooms/[roomId]/messages/[messageId]/route"
    );
    const deleted = await deleteMessageRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/messages/${messageId}`,
        { method: "DELETE", headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId, messageId }),
    );
    expect(deleted.status).toBe(200);

    const chunkAfter = await chunkRoute(
      new Request(
        `http://localhost/api/rooms/${owner.roomId}/attachments/${attachmentId}/1`,
        { headers: { cookie: owner.cookie } },
      ),
      ctx({ roomId: owner.roomId, attachmentId, chunk: "1" }),
    );
    expect(chunkAfter.status).toBe(404);
  });
});
