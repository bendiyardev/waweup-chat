import { toDescendingKey } from "@/lib/crypto/ids";

/** Blob object layout for a room. */

export function metaPath(roomId: string): string {
  return `rooms/${roomId}/meta.json`;
}

export function messagesPrefix(roomId: string): string {
  return `rooms/${roomId}/messages/`;
}

/**
 * Messages are stored under the lexicographic inverse of their ULID so an
 * ascending blob listing returns newest messages first.
 */
export function messagePath(roomId: string, messageId: string): string {
  return `${messagesPrefix(roomId)}${toDescendingKey(messageId)}.json`;
}

export function filesPrefix(roomId: string): string {
  return `rooms/${roomId}/files/`;
}

export function attachmentPrefix(roomId: string, attachmentId: string): string {
  return `${filesPrefix(roomId)}${attachmentId}/`;
}

export function chunkPath(
  roomId: string,
  attachmentId: string,
  chunkIndex: number,
): string {
  return `${attachmentPrefix(roomId, attachmentId)}${String(chunkIndex).padStart(5, "0")}.bin`;
}

export function roomPrefix(roomId: string): string {
  return `rooms/${roomId}/`;
}

export function expiryDateFolder(expiresAt: Date): string {
  return expiresAt.toISOString().slice(0, 10);
}

export function expiryPath(roomId: string, expiresAt: Date): string {
  return `expiry/${expiryDateFolder(expiresAt)}/${roomId}.json`;
}

export function expiryPrefix(): string {
  return "expiry/";
}
