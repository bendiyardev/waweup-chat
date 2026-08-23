import { APP_CONFIG } from "@/lib/config";
import type { RoomMaterial, RoomMeta, RoomPublicInfo } from "@/types/room";

export function toPublicInfo(meta: RoomMeta): RoomPublicInfo {
  return {
    roomId: meta.roomId,
    protocolVersion: meta.crypto.protocolVersion,
    salt: meta.crypto.salt,
    kdf: meta.crypto.kdf,
    cryptoVersion: meta.crypto.cryptoVersion,
    locked: meta.locked,
    full: meta.members.length >= APP_CONFIG.maxMembers,
    expiresAt: meta.expiresAt,
  };
}

export function toMaterial(meta: RoomMeta): RoomMaterial {
  return {
    encryptedRoomName: meta.encryptedRoomName,
    roomNameEpoch: meta.roomNameEpoch,
    currentEpoch: meta.crypto.currentEpoch,
    epochs: meta.crypto.epochs.map((e) => ({
      epoch: e.epoch,
      wrappedKey: e.wrappedKey,
    })),
    cryptoVersion: meta.crypto.cryptoVersion,
    members: meta.members.map((m) => ({
      memberId: m.memberId,
      role: m.role,
      encryptedDisplayName: m.encryptedDisplayName,
      displayNameEpoch: m.displayNameEpoch,
      joinedAt: m.joinedAt,
    })),
    expiresAt: meta.expiresAt,
  };
}
