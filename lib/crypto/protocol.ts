import { APP_CONFIG } from "@/lib/config";
import type { EncryptedBox } from "@/types/crypto";
import type { MessageKind, MessagePayload } from "@/types/message";
import { aesGcmDecrypt, aesGcmEncrypt } from "./aes";
import { utf8Decode, utf8Encode } from "./encoding";

const V = APP_CONFIG.cryptoProtocolVersion;

/**
 * AAD binds each ciphertext to its protocol version, room, message identity,
 * kind and key epoch so envelopes cannot be replayed under another identity.
 */
export function messageAad(
  roomId: string,
  messageId: string,
  kind: MessageKind,
  keyEpoch: number,
): string {
  return `v${V}|${roomId}|msg|${messageId}|${kind}|${keyEpoch}`;
}

export function roomNameAad(roomId: string, epoch: number): string {
  return `v${V}|${roomId}|roomname|${epoch}`;
}

/**
 * Display names are bound to the room and epoch. The member ID is not part
 * of the AAD because a new member's ID is assigned server-side only after
 * their encrypted name has been produced.
 */
export function memberNameAad(roomId: string, epoch: number): string {
  return `v${V}|${roomId}|member|${epoch}`;
}

export function chunkAad(
  roomId: string,
  attachmentId: string,
  chunkIndex: number,
): string {
  return `v${V}|${roomId}|file|${attachmentId}|${chunkIndex}`;
}

export async function encryptMessagePayload(
  epochKey: CryptoKey,
  payload: MessagePayload,
  roomId: string,
  messageId: string,
  kind: MessageKind,
  keyEpoch: number,
): Promise<EncryptedBox> {
  return aesGcmEncrypt(
    epochKey,
    utf8Encode(JSON.stringify(payload)),
    messageAad(roomId, messageId, kind, keyEpoch),
  );
}

export async function decryptMessagePayload(
  epochKey: CryptoKey,
  box: EncryptedBox,
  roomId: string,
  messageId: string,
  kind: MessageKind,
  keyEpoch: number,
): Promise<MessagePayload> {
  const bytes = await aesGcmDecrypt(
    epochKey,
    box,
    messageAad(roomId, messageId, kind, keyEpoch),
  );
  return JSON.parse(utf8Decode(bytes)) as MessagePayload;
}

export async function encryptRoomName(
  epochKey: CryptoKey,
  name: string,
  roomId: string,
  epoch: number,
): Promise<EncryptedBox> {
  return aesGcmEncrypt(epochKey, utf8Encode(name), roomNameAad(roomId, epoch));
}

export async function decryptRoomName(
  epochKey: CryptoKey,
  box: EncryptedBox,
  roomId: string,
  epoch: number,
): Promise<string> {
  return utf8Decode(
    await aesGcmDecrypt(epochKey, box, roomNameAad(roomId, epoch)),
  );
}

export async function encryptMemberName(
  epochKey: CryptoKey,
  name: string,
  roomId: string,
  epoch: number,
): Promise<EncryptedBox> {
  return aesGcmEncrypt(
    epochKey,
    utf8Encode(name),
    memberNameAad(roomId, epoch),
  );
}

export async function decryptMemberName(
  epochKey: CryptoKey,
  box: EncryptedBox,
  roomId: string,
  epoch: number,
): Promise<string> {
  return utf8Decode(
    await aesGcmDecrypt(epochKey, box, memberNameAad(roomId, epoch)),
  );
}
