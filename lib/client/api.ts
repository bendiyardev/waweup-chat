"use client";

import type { ListMessagesResult, MessageEnvelope, MessageKind } from "@/types/message";
import type { EncryptedBox, KdfParams } from "@/types/crypto";
import type { RoomMaterial, RoomPublicInfo, SessionInfo } from "@/types/room";

export class ApiClientError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "ApiClientError";
  }
}

async function apiFetch<T>(
  path: string,
  init?: RequestInit & { idempotencyKey?: string },
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.idempotencyKey
          ? { "X-Idempotency-Key": init.idempotencyKey }
          : {}),
        ...(init?.headers ?? {}),
      },
      credentials: "same-origin",
      cache: "no-store",
    });
  } catch {
    throw new ApiClientError(0, "network_error", "Network error");
  }
  if (res.status === 204) return undefined as T;
  let body: unknown = null;
  try {
    body = await res.json();
  } catch {
    // Non-JSON error bodies fall through to the generic error below.
  }
  if (!res.ok) {
    const code =
      (body as { error?: { code?: string; message?: string } })?.error?.code ??
      `http_${res.status}`;
    const message = (body as { error?: { message?: string } })?.error?.message;
    throw new ApiClientError(res.status, code, message);
  }
  return body as T;
}

export interface RoomStateResponse {
  room: RoomPublicInfo;
  session: SessionInfo | null;
  material?: RoomMaterial;
}

export interface UnlockResponse {
  unlockToken?: string;
  material?: RoomMaterial;
  session: SessionInfo | null;
  locked?: boolean;
  full?: boolean;
  recovered?: boolean;
}

export const api = {
  createRoom(
    body: {
      roomId: string;
      encryptedRoomName: EncryptedBox;
      salt: string;
      kdf: KdfParams;
      authKey: string;
      wrappedEpochKey: EncryptedBox;
      recoveryKeyHash: string;
      expiresPreset: string;
    },
    idempotencyKey: string,
  ) {
    return apiFetch<{ roomId: string; expiresAt: string }>("/api/rooms", {
      method: "POST",
      body: JSON.stringify(body),
      idempotencyKey,
    });
  },

  getRoom(roomId: string) {
    return apiFetch<RoomStateResponse>(`/api/rooms/${roomId}`);
  },

  unlock(roomId: string, body: { authKey: string; recoveryKey?: string }) {
    return apiFetch<UnlockResponse>(`/api/rooms/${roomId}/unlock`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  join(
    roomId: string,
    body: {
      unlockToken?: string;
      encryptedDisplayName: EncryptedBox;
      displayNameEpoch: number;
    },
  ) {
    return apiFetch<{
      memberId: string;
      role: "owner" | "member";
      material: RoomMaterial;
    }>(`/api/rooms/${roomId}/join`, {
      method: "POST",
      body: JSON.stringify(body),
    });
  },

  listMessages(roomId: string, params?: { cursor?: string; after?: string }) {
    const query = new URLSearchParams();
    if (params?.cursor) query.set("cursor", params.cursor);
    if (params?.after) query.set("after", params.after);
    const suffix = query.size > 0 ? `?${query.toString()}` : "";
    return apiFetch<ListMessagesResult>(
      `/api/rooms/${roomId}/messages${suffix}`,
    );
  },

  sendMessage(
    roomId: string,
    body: {
      messageId: string;
      kind: MessageKind;
      keyEpoch: number;
      iv: string;
      ct: string;
      attachmentId?: string;
    },
  ) {
    return apiFetch<{ messageId: string; createdAt: string }>(
      `/api/rooms/${roomId}/messages`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  deleteMessage(roomId: string, messageId: string) {
    return apiFetch<{ ok: true }>(
      `/api/rooms/${roomId}/messages/${messageId}`,
      { method: "DELETE" },
    );
  },

  clearMessages(roomId: string) {
    return apiFetch<{ ok: true }>(`/api/rooms/${roomId}/messages`, {
      method: "DELETE",
    });
  },

  removeMember(roomId: string, memberId: string) {
    return apiFetch<{ ok: true }>(
      `/api/rooms/${roomId}/members/${memberId}/remove`,
      { method: "POST" },
    );
  },

  banMember(roomId: string, memberId: string, banIp: boolean) {
    return apiFetch<{ ok: true }>(
      `/api/rooms/${roomId}/members/${memberId}/ban`,
      { method: "POST", body: JSON.stringify({ banIp }) },
    );
  },

  lockRoom(roomId: string) {
    return apiFetch<{ ok: true }>(`/api/rooms/${roomId}/lock`, {
      method: "POST",
    });
  },

  unlockRoom(roomId: string) {
    return apiFetch<{ ok: true }>(`/api/rooms/${roomId}/unlock-room`, {
      method: "POST",
    });
  },

  rotateKey(roomId: string, body: { epoch: number; wrappedKey: EncryptedBox }) {
    return apiFetch<{ currentEpoch: number }>(
      `/api/rooms/${roomId}/rotate-key`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  changePassword(
    roomId: string,
    body: {
      salt: string;
      kdf: KdfParams;
      authKey: string;
      epochs: { epoch: number; wrappedKey: EncryptedBox }[];
      currentEpoch: number;
    },
  ) {
    return apiFetch<{ currentEpoch: number; cryptoVersion: number }>(
      `/api/rooms/${roomId}/change-password`,
      { method: "POST", body: JSON.stringify(body) },
    );
  },

  destroyRoom(roomId: string) {
    return apiFetch<{ ok: true }>(`/api/rooms/${roomId}`, {
      method: "DELETE",
    });
  },

  async downloadChunk(
    roomId: string,
    attachmentId: string,
    chunkIndex: number,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    const res = await fetch(
      `/api/rooms/${roomId}/attachments/${attachmentId}/${chunkIndex}`,
      { credentials: "same-origin", cache: "no-store", signal },
    );
    if (!res.ok) {
      throw new ApiClientError(res.status, `chunk_${res.status}`);
    }
    return new Uint8Array(await res.arrayBuffer());
  },
};

export type { MessageEnvelope };
