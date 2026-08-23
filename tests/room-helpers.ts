import { expect } from "vitest";
import { POST as createRoomRoute } from "@/app/api/rooms/route";
import { POST as unlockRoute } from "@/app/api/rooms/[roomId]/unlock/route";
import { POST as joinRoute } from "@/app/api/rooms/[roomId]/join/route";
import { POST as sendMessageRoute } from "@/app/api/rooms/[roomId]/messages/route";
import { importAesKey } from "@/lib/crypto/aes";
import { deriveMasterKey } from "@/lib/crypto/argon";
import {
  fromB64Url,
  randomBytes,
  sha256B64Url,
  toB64Url,
} from "@/lib/crypto/encoding";
import { generateRoomId, generateUlid } from "@/lib/crypto/ids";
import { deriveRoomKeys, wrapEpochKey } from "@/lib/crypto/keys";
import {
  encryptMemberName,
  encryptMessagePayload,
  encryptRoomName,
} from "@/lib/crypto/protocol";
import type { KdfParams } from "@/types/crypto";

export const KDF: KdfParams = {
  algorithm: "argon2id",
  memoryKiB: 8192,
  iterations: 1,
  parallelism: 1,
};

export function ctx(params: Record<string, string>) {
  return { params: Promise.resolve(params) } as never;
}

export function cookieFrom(res: Response): string {
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

export async function deriveCreds(password: string, saltB64: string) {
  const master = await deriveMasterKey(password, fromB64Url(saltB64), KDF);
  return deriveRoomKeys(master);
}

export interface TestOwner {
  roomId: string;
  cookie: string;
  kek: CryptoKey;
  authKeyB64: string;
  epochKey: CryptoKey;
  epochKeyRaw: Uint8Array;
  recoveryKey: string;
  password: string;
}

export async function createRoom(
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
  const res = await createRoomRoute(
    new Request("http://localhost/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        roomId,
        encryptedRoomName: await encryptRoomName(epochKey, name, roomId, 1),
        salt,
        kdf: KDF,
        authKey: authKeyB64,
        wrappedEpochKey: await wrapEpochKey(kek, epochKeyRaw, roomId, 1),
        recoveryKeyHash: await sha256B64Url(fromB64Url(recoveryKey)),
        expiresPreset: preset,
      }),
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
    password,
  };
}

export async function unlock(
  roomId: string,
  authKeyB64: string,
  options: { cookie?: string; recoveryKey?: string } = {},
) {
  return unlockRoute(
    new Request(`http://localhost/api/rooms/${roomId}/unlock`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: options.cookie ?? "",
      },
      body: JSON.stringify({
        authKey: authKeyB64,
        ...(options.recoveryKey ? { recoveryKey: options.recoveryKey } : {}),
      }),
    }),
    ctx({ roomId }),
  );
}

export async function join(
  roomId: string,
  epochKey: CryptoKey,
  displayName: string,
  options: { unlockToken?: string; cookie?: string; epoch?: number } = {},
) {
  const epoch = options.epoch ?? 1;
  const encryptedDisplayName = await encryptMemberName(
    epochKey,
    displayName,
    roomId,
    epoch,
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
        displayNameEpoch: epoch,
      }),
    }),
    ctx({ roomId }),
  );
}

export async function sendText(
  roomId: string,
  epochKey: CryptoKey,
  cookie: string,
  text: string,
  displayName: string,
  keyEpoch = 1,
) {
  const messageId = generateUlid();
  const box = await encryptMessagePayload(
    epochKey,
    { displayName, text },
    roomId,
    messageId,
    "text",
    keyEpoch,
  );
  const res = await sendMessageRoute(
    new Request(`http://localhost/api/rooms/${roomId}/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        messageId,
        kind: "text",
        keyEpoch,
        iv: box.iv,
        ct: box.ct,
      }),
    }),
    ctx({ roomId }),
  );
  return { res, messageId };
}
