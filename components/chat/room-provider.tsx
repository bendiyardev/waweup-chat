"use client";

import * as React from "react";
import type { Channel } from "pusher-js";
import type Pusher from "pusher-js";
import { APP_CONFIG } from "@/lib/config";
import { api, ApiClientError } from "@/lib/client/api";
import {
  decryptEnvelopeSafe,
  decryptMemberNameSafe,
  decryptRoomNameSafe,
  deriveCredentials,
  keysFromMaterial,
  wrapEpoch,
} from "@/lib/client/crypto-actions";
import {
  clearRoomKeys,
  getCurrentEpochKey,
  getRoomKeys,
  setRoomKeys,
} from "@/lib/client/keystore";
import { createRoomPusher, roomChannel } from "@/lib/client/pusher-client";
import { importAesKey } from "@/lib/crypto/aes";
import { randomBytes, toB64Url } from "@/lib/crypto/encoding";
import { generateUlid } from "@/lib/crypto/ids";
import {
  encryptMemberName,
  encryptMessagePayload,
} from "@/lib/crypto/protocol";
import type {
  MessageEnvelope,
  MessageKind,
  MessagePayload,
  SystemEventType,
} from "@/types/message";
import type { RoomMaterial, RoomPublicInfo } from "@/types/room";

export type RoomPhase = "checking" | "password" | "name" | "ready";

/** Locale-independent unlock error identifiers; the UI translates them. */
export type UnlockErrorKey =
  | "invalid-password"
  | "invalid-recovery"
  | "too-many"
  | "cant-unlock"
  | "generic";

export type FatalKind =
  | "not-found"
  | "gone"
  | "destroyed"
  | "full"
  | "banned"
  | "locked"
  | "removed"
  | "network";

export interface ChatMessage {
  envelope: MessageEnvelope;
  payload: MessagePayload | null;
  decryptFailure?: "locked" | "corrupt";
  status: "sent" | "pending" | "failed";
}

export interface MemberView {
  memberId: string;
  role: "owner" | "member";
  name: string | null;
  online: boolean;
  joinedAt: string;
}

export interface ReplyRef {
  messageId: string;
  displayName: string;
  preview: string;
}

export interface RoomContextValue {
  roomId: string;
  phase: RoomPhase;
  fatal: FatalKind | null;
  roomPublic: RoomPublicInfo | null;
  roomName: string | null;
  members: MemberView[];
  me: { memberId: string; role: "owner" | "member" } | null;
  myName: string | null;
  messages: ChatMessage[];
  hasMore: boolean;
  loadingOlder: boolean;
  connection: "online" | "connecting" | "offline";
  typingNames: string[];
  passwordStale: boolean;
  expiresAt: string | null;
  locked: boolean;
  unlockError: UnlockErrorKey | null;
  unlockBusy: boolean;
  joinBusy: boolean;
  retryCheck: () => void;
  unlock: (password: string, recoveryKey?: string) => Promise<void>;
  join: (name: string) => Promise<void>;
  sendText: (text: string, replyTo?: ReplyRef) => Promise<void>;
  sendAttachmentMessage: (
    kind: MessageKind,
    payloadAttachment: NonNullable<MessagePayload["attachment"]>,
    keyEpoch: number,
  ) => Promise<void>;
  resend: (messageId: string) => Promise<void>;
  loadOlder: () => Promise<void>;
  deleteMessage: (messageId: string) => Promise<void>;
  notifyTyping: () => void;
  removeMember: (memberId: string) => Promise<void>;
  banMember: (memberId: string, banIp: boolean) => Promise<void>;
  lockRoom: (locked: boolean) => Promise<void>;
  clearAllMessages: () => Promise<void>;
  destroyRoom: () => Promise<void>;
  rotateKey: () => Promise<void>;
  changePassword: (newPassword: string) => Promise<void>;
  leaveRoom: () => Promise<void>;
}

const RoomContext = React.createContext<RoomContextValue | null>(null);

export function useRoom(): RoomContextValue {
  const value = React.useContext(RoomContext);
  if (!value) throw new Error("useRoom outside RoomProvider");
  return value;
}

function sortMessages(list: ChatMessage[]): ChatMessage[] {
  return [...list].sort((a, b) =>
    a.envelope.messageId < b.envelope.messageId
      ? -1
      : a.envelope.messageId > b.envelope.messageId
        ? 1
        : 0,
  );
}

export function RoomProvider({
  roomId,
  children,
}: {
  roomId: string;
  children: React.ReactNode;
}) {
  const [phase, setPhase] = React.useState<RoomPhase>("checking");
  const [fatal, setFatal] = React.useState<FatalKind | null>(null);
  const [roomPublic, setRoomPublic] = React.useState<RoomPublicInfo | null>(
    null,
  );
  const [roomName, setRoomName] = React.useState<string | null>(null);
  const [members, setMembers] = React.useState<MemberView[]>([]);
  const [me, setMe] = React.useState<{
    memberId: string;
    role: "owner" | "member";
  } | null>(null);
  const [myName, setMyName] = React.useState<string | null>(null);
  const [messages, setMessages] = React.useState<ChatMessage[]>([]);
  const [hasMore, setHasMore] = React.useState(false);
  const [loadingOlder, setLoadingOlder] = React.useState(false);
  const [connection, setConnection] = React.useState<
    "online" | "connecting" | "offline"
  >("connecting");
  const [typingIds, setTypingIds] = React.useState<Map<string, number>>(
    new Map(),
  );
  const [passwordStale, setPasswordStale] = React.useState(false);
  const [unlockError, setUnlockError] = React.useState<UnlockErrorKey | null>(null);
  const [unlockBusy, setUnlockBusy] = React.useState(false);
  const [joinBusy, setJoinBusy] = React.useState(false);
  const [checkNonce, setCheckNonce] = React.useState(0);

  const unlockTokenRef = React.useRef<string | null>(null);
  const materialRef = React.useRef<RoomMaterial | null>(null);
  const pusherRef = React.useRef<Pusher | null>(null);
  const channelRef = React.useRef<Channel | null>(null);
  const onlineIdsRef = React.useRef<Set<string>>(new Set());
  // Polling fallback (used when Pusher realtime is not configured).
  const pollTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingRef = React.useRef(false);
  const cursorRef = React.useRef<string | null>(null);
  const myNameRef = React.useRef<string | null>(null);
  const meRef = React.useRef<{ memberId: string; role: "owner" | "member" } | null>(null);
  const lastTypingSentRef = React.useRef(0);
  const messagesRef = React.useRef<ChatMessage[]>([]);
  const phaseRef = React.useRef<RoomPhase>("checking");
  const mountedRef = React.useRef(true);

  messagesRef.current = messages;
  phaseRef.current = phase;
  myNameRef.current = myName;
  meRef.current = me;

  const newestSentId = React.useCallback((): string | null => {
    for (let i = messagesRef.current.length - 1; i >= 0; i--) {
      const msg = messagesRef.current[i];
      if (msg && msg.status === "sent") return msg.envelope.messageId;
    }
    return null;
  }, []);

  const teardownRealtime = React.useCallback(() => {
    if (channelRef.current) {
      channelRef.current.unbind_all();
      channelRef.current = null;
    }
    if (pusherRef.current) {
      pusherRef.current.disconnect();
      pusherRef.current = null;
    }
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    pollingRef.current = false;
  }, []);

  const failFatal = React.useCallback(
    (kind: FatalKind) => {
      teardownRealtime();
      clearRoomKeys(roomId);
      setFatal(kind);
    },
    [roomId, teardownRealtime],
  );

  /** Decrypts material into UI state (room name + member names). */
  const applyMaterial = React.useCallback(
    async (material: RoomMaterial) => {
      materialRef.current = material;
      const name = await decryptRoomNameSafe(
        roomId,
        material.encryptedRoomName,
        material.roomNameEpoch,
      );
      const views: MemberView[] = [];
      for (const member of material.members) {
        views.push({
          memberId: member.memberId,
          role: member.role,
          name: await decryptMemberNameSafe(
            roomId,
            member.encryptedDisplayName,
            member.displayNameEpoch,
          ),
          // Presence is a Pusher-only concept. When polling, membership in the
          // material already means the member is in the room, so show them as
          // present rather than misleadingly offline.
          online:
            pollingRef.current || onlineIdsRef.current.has(member.memberId),
          joinedAt: member.joinedAt,
        });
      }
      if (!mountedRef.current) return;
      setRoomName(name);
      setMembers(views);
      const mine = meRef.current
        ? views.find((v) => v.memberId === meRef.current?.memberId)
        : null;
      if (mine?.name) {
        setMyName(mine.name);
        myNameRef.current = mine.name;
      }
    },
    [roomId],
  );

  /** Re-fetches room + material (after membership or crypto changes). */
  const refreshMaterial = React.useCallback(async () => {
    try {
      const state = await api.getRoom(roomId);
      if (!mountedRef.current) return;
      setRoomPublic(state.room);
      if (!state.session) {
        // Our session no longer exists - we were removed.
        failFatal("removed");
        return;
      }
      if (state.material) {
        const keys = getRoomKeys(roomId);
        if (keys) {
          const rebuilt = await keysFromMaterial(
            roomId,
            keys.kek,
            keys.authKeyB64,
            state.material,
          );
          // Keep any previously unwrapped epochs (e.g. pre-password-change).
          for (const [epoch, entry] of keys.epochKeys) {
            if (!rebuilt.epochKeys.has(epoch)) {
              rebuilt.epochKeys.set(epoch, entry);
            }
          }
          setRoomKeys(roomId, rebuilt);
          setPasswordStale(!rebuilt.epochKeys.has(rebuilt.currentEpoch));
        }
        await applyMaterial(state.material);
      }
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.status === 410) failFatal("gone");
        else if (error.status === 404) failFatal("destroyed");
      }
    }
  }, [roomId, applyMaterial, failFatal]);

  const upsertEnvelope = React.useCallback(
    async (envelope: MessageEnvelope, status: ChatMessage["status"]) => {
      const result = await decryptEnvelopeSafe(envelope);
      const message: ChatMessage = {
        envelope,
        payload: result.ok ? result.payload : null,
        decryptFailure: result.ok ? undefined : result.reason,
        status,
      };
      if (!mountedRef.current) return;
      setMessages((prev) => {
        const index = prev.findIndex(
          (m) => m.envelope.messageId === envelope.messageId,
        );
        if (index >= 0) {
          const next = [...prev];
          const existing = next[index];
          if (existing) {
            next[index] = {
              ...message,
              // Never downgrade a sent message to pending.
              status: existing.status === "sent" ? "sent" : status,
            };
          }
          return next;
        }
        return sortMessages([...prev, message]);
      });
    },
    [],
  );

  /** Fetches messages newer than the newest we have (realtime gap repair). */
  const reconcile = React.useCallback(async () => {
    const after = newestSentId();
    try {
      const result = after
        ? await api.listMessages(roomId, { after })
        : await api.listMessages(roomId);
      for (const envelope of result.messages) {
        await upsertEnvelope(envelope, "sent");
      }
      if (!after) {
        cursorRef.current = result.cursor;
        setHasMore(result.hasMore);
      }
    } catch {
      // Network problems are surfaced through the connection indicator.
    }
  }, [roomId, newestSentId, upsertEnvelope]);

  const handleTypingEvent = React.useCallback((memberId: string) => {
    setTypingIds((prev) => {
      const next = new Map(prev);
      next.set(memberId, Date.now() + 3000);
      return next;
    });
  }, []);

  // Expire typing indicators.
  React.useEffect(() => {
    if (typingIds.size === 0) return;
    const timer = setInterval(() => {
      setTypingIds((prev) => {
        const now = Date.now();
        let changed = false;
        const next = new Map(prev);
        for (const [id, until] of next) {
          if (until <= now) {
            next.delete(id);
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [typingIds]);

  const connectRealtime = React.useCallback(() => {
    if (pusherRef.current || pollTimerRef.current) return;
    const pusher = createRoomPusher(roomId);
    if (!pusher) {
      // No Pusher configured: fall back to polling for new messages and
      // room/membership changes. reconcile() covers new messages;
      // refreshMaterial() covers joins/leaves, lock/unlock, key rotation and
      // room destruction (surfaced as a 404).
      pollingRef.current = true;
      setConnection("online");
      void reconcile();
      void refreshMaterial();
      pollTimerRef.current = setInterval(() => {
        if (!mountedRef.current) return;
        void reconcile();
        void refreshMaterial();
      }, 3000);
      return;
    }
    pusherRef.current = pusher;

    pusher.connection.bind(
      "state_change",
      (states: { previous: string; current: string }) => {
        if (!mountedRef.current) return;
        if (states.current === "connected") {
          setConnection("online");
          void reconcile();
        } else if (
          states.current === "connecting" ||
          states.current === "unavailable"
        ) {
          setConnection("connecting");
        } else if (states.current === "disconnected") {
          setConnection("offline");
        }
      },
    );

    const channel = pusher.subscribe(roomChannel(roomId));
    channelRef.current = channel;

    channel.bind(
      "pusher:subscription_succeeded",
      (data: { members?: Record<string, unknown> }) => {
        onlineIdsRef.current = new Set(Object.keys(data.members ?? {}));
        setMembers((prev) =>
          prev.map((m) => ({
            ...m,
            online: onlineIdsRef.current.has(m.memberId),
          })),
        );
      },
    );
    channel.bind("pusher:member_added", (member: { id: string }) => {
      onlineIdsRef.current.add(member.id);
      setMembers((prev) =>
        prev.map((m) =>
          m.memberId === member.id ? { ...m, online: true } : m,
        ),
      );
      // A newly joined member may not be in our member list yet.
      void refreshMaterial();
    });
    channel.bind("pusher:member_removed", (member: { id: string }) => {
      onlineIdsRef.current.delete(member.id);
      setMembers((prev) =>
        prev.map((m) =>
          m.memberId === member.id ? { ...m, online: false } : m,
        ),
      );
    });

    channel.bind(
      "message-new",
      (data: { envelope?: MessageEnvelope; messageId?: string }) => {
        if (data.envelope) {
          void upsertEnvelope(data.envelope, "sent");
        } else {
          void reconcile();
        }
      },
    );
    channel.bind("message-deleted", (data: { messageId?: string }) => {
      if (!data.messageId) return;
      setMessages((prev) =>
        prev.filter((m) => m.envelope.messageId !== data.messageId),
      );
    });
    channel.bind("messages-cleared", () => {
      setMessages([]);
      cursorRef.current = null;
      setHasMore(false);
    });
    channel.bind("member-removed", (data: { memberId?: string }) => {
      if (data.memberId && data.memberId === meRef.current?.memberId) {
        failFatal("removed");
      } else {
        void refreshMaterial();
      }
    });
    channel.bind("member-banned", (data: { memberId?: string }) => {
      if (data.memberId && data.memberId === meRef.current?.memberId) {
        failFatal("banned");
      } else {
        void refreshMaterial();
      }
    });
    channel.bind("room-locked", () => {
      setRoomPublic((prev) => (prev ? { ...prev, locked: true } : prev));
    });
    channel.bind("room-unlocked", () => {
      setRoomPublic((prev) => (prev ? { ...prev, locked: false } : prev));
    });
    channel.bind("crypto-rotated", () => {
      void refreshMaterial();
    });
    channel.bind("room-destroyed", () => {
      failFatal("destroyed");
    });
    channel.bind("client-typing", (data: { memberId?: string }) => {
      if (data.memberId && data.memberId !== meRef.current?.memberId) {
        handleTypingEvent(data.memberId);
      }
    });
  }, [
    roomId,
    reconcile,
    refreshMaterial,
    upsertEnvelope,
    failFatal,
    handleTypingEvent,
  ]);

  /** Loads history + realtime once the room is unlocked and joined. */
  const bootstrap = React.useCallback(async () => {
    setPhase("ready");
    connectRealtime();
    try {
      const result = await api.listMessages(roomId);
      const decrypted: ChatMessage[] = [];
      for (const envelope of result.messages) {
        const dec = await decryptEnvelopeSafe(envelope);
        decrypted.push({
          envelope,
          payload: dec.ok ? dec.payload : null,
          decryptFailure: dec.ok ? undefined : dec.reason,
          status: "sent",
        });
      }
      if (!mountedRef.current) return;
      // Merge, don't replace: a realtime message may have landed while the
      // history request was in flight.
      setMessages((prev) => {
        const loaded = new Set(decrypted.map((m) => m.envelope.messageId));
        const extras = prev.filter(
          (m) => !loaded.has(m.envelope.messageId),
        );
        return sortMessages([...decrypted, ...extras]);
      });
      cursorRef.current = result.cursor;
      setHasMore(result.hasMore);
    } catch (error) {
      if (error instanceof ApiClientError && error.status === 410) {
        failFatal("gone");
      }
    }
  }, [roomId, connectRealtime, failFatal]);

  /** Initial route check. */
  React.useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;
    (async () => {
      try {
        const state = await api.getRoom(roomId);
        if (cancelled) return;
        setRoomPublic(state.room);
        const keys = getRoomKeys(roomId);
        if (state.session && state.material && keys) {
          const rebuilt = await keysFromMaterial(
            roomId,
            keys.kek,
            keys.authKeyB64,
            state.material,
          );
          setRoomKeys(roomId, rebuilt);
          // meRef must be current BEFORE applyMaterial so our own decrypted
          // display name is picked up.
          meRef.current = {
            memberId: state.session.memberId,
            role: state.session.role,
          };
          setMe(meRef.current);
          await applyMaterial(state.material);
          if (state.session.hasDisplayName) {
            await bootstrap();
          } else {
            setPhase("name");
          }
          return;
        }
        setPhase("password");
      } catch (error) {
        if (cancelled) return;
        if (error instanceof ApiClientError) {
          if (error.status === 404) setFatal("not-found");
          else if (error.status === 410) setFatal("gone");
          else setFatal("network");
        } else {
          setFatal("network");
        }
      }
    })();
    return () => {
      cancelled = true;
      mountedRef.current = false;
      teardownRealtime();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, checkNonce]);

  /** Browser connectivity: reflect offline instantly, reconcile on return. */
  React.useEffect(() => {
    const goOnline = () => {
      if (phaseRef.current !== "ready") return;
      // Pusher will emit its own "connected" once the socket is back; until
      // then show the reconnecting state (or online when realtime is off).
      setConnection(pusherRef.current ? "connecting" : "online");
      void reconcile();
    };
    const goOffline = () => {
      if (phaseRef.current === "ready") setConnection("offline");
    };
    window.addEventListener("online", goOnline);
    window.addEventListener("offline", goOffline);
    return () => {
      window.removeEventListener("online", goOnline);
      window.removeEventListener("offline", goOffline);
    };
  }, [reconcile]);

  /** Hard expiry on the client: flip to gone the moment time runs out. */
  React.useEffect(() => {
    if (!roomPublic?.expiresAt || fatal) return;
    const check = () => {
      if (new Date(roomPublic.expiresAt).getTime() <= Date.now()) {
        failFatal("gone");
      }
    };
    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, [roomPublic?.expiresAt, fatal, failFatal]);

  const unlock = React.useCallback(
    async (password: string, recoveryKey?: string) => {
      if (!roomPublic) return;
      setUnlockBusy(true);
      setUnlockError(null);
      try {
        const creds = await deriveCredentials(
          password,
          roomPublic.salt,
          roomPublic.kdf,
        );
        const res = await api.unlock(roomId, {
          authKey: creds.authKeyB64,
          ...(recoveryKey ? { recoveryKey } : {}),
        });
        if (res.locked) {
          failFatal("locked");
          return;
        }
        if (res.full) {
          failFatal("full");
          return;
        }
        if (!res.material) {
          setUnlockError("cant-unlock");
          return;
        }
        const keys = await keysFromMaterial(
          roomId,
          creds.kek,
          creds.authKeyB64,
          res.material,
        );
        setRoomKeys(roomId, keys);
        setPasswordStale(!keys.epochKeys.has(keys.currentEpoch));
        if (res.session) {
          // meRef before applyMaterial: our decrypted name depends on it.
          meRef.current = {
            memberId: res.session.memberId,
            role: res.session.role,
          };
          setMe(meRef.current);
        }
        await applyMaterial(res.material);
        if (res.session) {
          if (res.session.hasDisplayName) {
            await bootstrap();
          } else {
            setPhase("name");
          }
        } else {
          unlockTokenRef.current = res.unlockToken ?? null;
          setPhase("name");
        }
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.code === "invalid_password") {
            setUnlockError("invalid-password");
          } else if (error.code === "invalid_recovery_key") {
            setUnlockError("invalid-recovery");
          } else if (error.status === 429) {
            setUnlockError("too-many");
          } else if (error.status === 410) {
            failFatal("gone");
          } else if (error.status === 404) {
            failFatal("not-found");
          } else {
            setUnlockError("generic");
          }
        } else {
          setUnlockError("generic");
        }
      } finally {
        if (mountedRef.current) setUnlockBusy(false);
      }
    },
    [roomId, roomPublic, applyMaterial, bootstrap, failFatal],
  );

  const sendSystemMessage = React.useCallback(
    async (type: SystemEventType, subject?: string) => {
      const current = getCurrentEpochKey(roomId);
      const name = myNameRef.current;
      if (!current || !name) return;
      const messageId = generateUlid();
      const payload: MessagePayload = {
        displayName: name,
        system: { type, ...(subject ? { subject } : {}) },
      };
      try {
        const box = await encryptMessagePayload(
          current.key,
          payload,
          roomId,
          messageId,
          "system",
          current.epoch,
        );
        const envelope: MessageEnvelope = {
          protocolVersion: 1,
          roomId,
          messageId,
          memberId: meRef.current?.memberId ?? "",
          kind: "system",
          keyEpoch: current.epoch,
          createdAt: new Date().toISOString(),
          iv: box.iv,
          ct: box.ct,
        };
        await upsertEnvelope(envelope, "pending");
        await api.sendMessage(roomId, {
          messageId,
          kind: "system",
          keyEpoch: current.epoch,
          iv: box.iv,
          ct: box.ct,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.envelope.messageId === messageId ? { ...m, status: "sent" } : m,
          ),
        );
      } catch {
        // System notes are best-effort; drop the optimistic row on failure.
        setMessages((prev) =>
          prev.filter((m) => m.envelope.messageId !== messageId),
        );
      }
    },
    [roomId, upsertEnvelope],
  );

  const join = React.useCallback(
    async (name: string) => {
      const keys = getRoomKeys(roomId);
      const current = getCurrentEpochKey(roomId);
      if (!keys || !current) {
        setPhase("password");
        return;
      }
      setJoinBusy(true);
      try {
        const encryptedDisplayName = await encryptMemberName(
          current.key,
          name,
          roomId,
          current.epoch,
        );
        const res = await api.join(roomId, {
          ...(unlockTokenRef.current && !me
            ? { unlockToken: unlockTokenRef.current }
            : {}),
          encryptedDisplayName,
          displayNameEpoch: current.epoch,
        });
        unlockTokenRef.current = null;
        setMe({ memberId: res.memberId, role: res.role });
        setMyName(name);
        myNameRef.current = name;
        meRef.current = { memberId: res.memberId, role: res.role };
        await applyMaterial(res.material);
        await bootstrap();
        await sendSystemMessage("joined");
      } catch (error) {
        if (error instanceof ApiClientError) {
          if (error.code === "room_full") failFatal("full");
          else if (error.code === "banned") failFatal("banned");
          else if (error.code === "room_locked") failFatal("locked");
          else if (error.status === 401) setPhase("password");
          else if (error.status === 410) failFatal("gone");
        }
        throw error;
      } finally {
        if (mountedRef.current) setJoinBusy(false);
      }
    },
    [roomId, me, applyMaterial, bootstrap, failFatal, sendSystemMessage],
  );

  const sendText = React.useCallback(
    async (text: string, replyTo?: ReplyRef) => {
      const current = getCurrentEpochKey(roomId);
      const name = myNameRef.current;
      if (!current || !name || !meRef.current) return;
      const trimmed = text.trim();
      if (!trimmed || trimmed.length > APP_CONFIG.maxTextLength) return;
      const messageId = generateUlid();
      const payload: MessagePayload = {
        displayName: name,
        text: trimmed,
        ...(replyTo ? { replyTo } : {}),
      };
      const box = await encryptMessagePayload(
        current.key,
        payload,
        roomId,
        messageId,
        "text",
        current.epoch,
      );
      const envelope: MessageEnvelope = {
        protocolVersion: 1,
        roomId,
        messageId,
        memberId: meRef.current.memberId,
        kind: "text",
        keyEpoch: current.epoch,
        createdAt: new Date().toISOString(),
        iv: box.iv,
        ct: box.ct,
      };
      await upsertEnvelope(envelope, "pending");
      try {
        const res = await api.sendMessage(roomId, {
          messageId,
          kind: "text",
          keyEpoch: current.epoch,
          iv: box.iv,
          ct: box.ct,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.envelope.messageId === messageId
              ? {
                  ...m,
                  status: "sent",
                  envelope: { ...m.envelope, createdAt: res.createdAt },
                }
              : m,
          ),
        );
      } catch (error) {
        if (error instanceof ApiClientError && error.status === 410) {
          failFatal("gone");
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.envelope.messageId === messageId
              ? { ...m, status: "failed" }
              : m,
          ),
        );
      }
    },
    [roomId, upsertEnvelope, failFatal],
  );

  const sendAttachmentMessage = React.useCallback(
    async (
      kind: MessageKind,
      attachment: NonNullable<MessagePayload["attachment"]>,
      keyEpoch: number,
    ) => {
      const keys = getRoomKeys(roomId);
      const name = myNameRef.current;
      if (!keys || !name || !meRef.current) return;
      const epochEntry = keys.epochKeys.get(keyEpoch);
      if (!epochEntry) return;
      const messageId = generateUlid();
      const payload: MessagePayload = { displayName: name, attachment };
      const box = await encryptMessagePayload(
        epochEntry.key,
        payload,
        roomId,
        messageId,
        kind,
        keyEpoch,
      );
      const envelope: MessageEnvelope = {
        protocolVersion: 1,
        roomId,
        messageId,
        memberId: meRef.current.memberId,
        kind,
        keyEpoch,
        createdAt: new Date().toISOString(),
        attachmentId: attachment.attachmentId,
        iv: box.iv,
        ct: box.ct,
      };
      await upsertEnvelope(envelope, "pending");
      try {
        await api.sendMessage(roomId, {
          messageId,
          kind,
          keyEpoch,
          iv: box.iv,
          ct: box.ct,
          attachmentId: attachment.attachmentId,
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.envelope.messageId === messageId ? { ...m, status: "sent" } : m,
          ),
        );
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.envelope.messageId === messageId
              ? { ...m, status: "failed" }
              : m,
          ),
        );
      }
    },
    [roomId, upsertEnvelope],
  );

  const resend = React.useCallback(
    async (messageId: string) => {
      const message = messagesRef.current.find(
        (m) => m.envelope.messageId === messageId,
      );
      if (!message || message.status !== "failed") return;
      setMessages((prev) =>
        prev.map((m) =>
          m.envelope.messageId === messageId ? { ...m, status: "pending" } : m,
        ),
      );
      try {
        await api.sendMessage(roomId, {
          messageId,
          kind: message.envelope.kind,
          keyEpoch: message.envelope.keyEpoch,
          iv: message.envelope.iv,
          ct: message.envelope.ct,
          ...(message.envelope.attachmentId
            ? { attachmentId: message.envelope.attachmentId }
            : {}),
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.envelope.messageId === messageId ? { ...m, status: "sent" } : m,
          ),
        );
      } catch (error) {
        // A duplicate means the first attempt actually landed.
        if (error instanceof ApiClientError && error.status === 409) {
          setMessages((prev) =>
            prev.map((m) =>
              m.envelope.messageId === messageId
                ? { ...m, status: "sent" }
                : m,
            ),
          );
          return;
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.envelope.messageId === messageId
              ? { ...m, status: "failed" }
              : m,
          ),
        );
      }
    },
    [roomId],
  );

  const loadOlder = React.useCallback(async () => {
    if (!cursorRef.current || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await api.listMessages(roomId, {
        cursor: cursorRef.current,
      });
      const decrypted: ChatMessage[] = [];
      for (const envelope of result.messages) {
        const dec = await decryptEnvelopeSafe(envelope);
        decrypted.push({
          envelope,
          payload: dec.ok ? dec.payload : null,
          decryptFailure: dec.ok ? undefined : dec.reason,
          status: "sent",
        });
      }
      cursorRef.current = result.cursor;
      if (!mountedRef.current) return;
      setHasMore(result.hasMore);
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.envelope.messageId));
        const fresh = decrypted.filter(
          (m) => !known.has(m.envelope.messageId),
        );
        return sortMessages([...fresh, ...prev]);
      });
    } finally {
      if (mountedRef.current) setLoadingOlder(false);
    }
  }, [roomId, loadingOlder]);

  const deleteMessage = React.useCallback(
    async (messageId: string) => {
      await api.deleteMessage(roomId, messageId);
      setMessages((prev) =>
        prev.filter((m) => m.envelope.messageId !== messageId),
      );
    },
    [roomId],
  );

  const notifyTyping = React.useCallback(() => {
    const now = Date.now();
    if (now - lastTypingSentRef.current < 1000) return;
    lastTypingSentRef.current = now;
    try {
      channelRef.current?.trigger("client-typing", {
        memberId: meRef.current?.memberId,
      });
    } catch {
      // Client events require enabling in Pusher settings; typing is optional.
    }
  }, []);

  const removeMember = React.useCallback(
    async (memberId: string) => {
      const target = members.find((m) => m.memberId === memberId);
      await api.removeMember(roomId, memberId);
      await sendSystemMessage("removed", target?.name ?? undefined);
      await refreshMaterial();
    },
    [roomId, members, refreshMaterial, sendSystemMessage],
  );

  const banMember = React.useCallback(
    async (memberId: string, banIp: boolean) => {
      const target = members.find((m) => m.memberId === memberId);
      await api.banMember(roomId, memberId, banIp);
      await sendSystemMessage("banned", target?.name ?? undefined);
      await refreshMaterial();
    },
    [roomId, members, refreshMaterial, sendSystemMessage],
  );

  const lockRoom = React.useCallback(
    async (locked: boolean) => {
      if (locked) await api.lockRoom(roomId);
      else await api.unlockRoom(roomId);
      await sendSystemMessage(locked ? "room-locked" : "room-unlocked");
      setRoomPublic((prev) => (prev ? { ...prev, locked } : prev));
    },
    [roomId, sendSystemMessage],
  );

  const clearAllMessages = React.useCallback(async () => {
    await api.clearMessages(roomId);
    setMessages([]);
    cursorRef.current = null;
    setHasMore(false);
    await sendSystemMessage("chat-cleared");
  }, [roomId, sendSystemMessage]);

  const destroyRoom = React.useCallback(async () => {
    await api.destroyRoom(roomId);
    failFatal("destroyed");
  }, [roomId, failFatal]);

  const rotateKey = React.useCallback(async () => {
    const keys = getRoomKeys(roomId);
    if (!keys) return;
    const epoch = keys.currentEpoch + 1;
    const raw = randomBytes(32);
    const wrappedKey = await wrapEpoch(keys.kek, raw, roomId, epoch);
    await api.rotateKey(roomId, { epoch, wrappedKey });
    keys.epochKeys.set(epoch, { key: await importAesKey(raw), raw });
    keys.currentEpoch = epoch;
    keys.cryptoVersion += 1;
    setRoomKeys(roomId, keys);
    await sendSystemMessage("key-rotated");
  }, [roomId, sendSystemMessage]);

  const changePassword = React.useCallback(
    async (newPassword: string) => {
      const keys = getRoomKeys(roomId);
      const material = materialRef.current;
      if (!keys || !material) throw new Error("Room keys unavailable");
      // Every existing epoch must be re-wrappable, otherwise history would
      // break for holders of the new password.
      for (const entry of material.epochs) {
        if (!keys.epochKeys.has(entry.epoch)) {
          throw new Error("Missing epoch keys - cannot change password");
        }
      }
      const salt = toB64Url(randomBytes(16));
      const kdf = roomPublic?.kdf ?? {
        algorithm: "argon2id" as const,
        memoryKiB: 65536,
        iterations: 3,
        parallelism: 1,
      };
      const creds = await deriveCredentials(newPassword, salt, kdf);
      const newEpochNumber = keys.currentEpoch + 1;
      const newEpochRaw = randomBytes(32);
      const epochs: { epoch: number; wrappedKey: { iv: string; ct: string } }[] =
        [];
      for (const [epoch, entry] of keys.epochKeys) {
        epochs.push({
          epoch,
          wrappedKey: await wrapEpoch(creds.kek, entry.raw, roomId, epoch),
        });
      }
      epochs.push({
        epoch: newEpochNumber,
        wrappedKey: await wrapEpoch(
          creds.kek,
          newEpochRaw,
          roomId,
          newEpochNumber,
        ),
      });
      await api.changePassword(roomId, {
        salt,
        kdf,
        authKey: creds.authKeyB64,
        epochs,
        currentEpoch: newEpochNumber,
      });
      keys.kek = creds.kek;
      keys.authKeyB64 = creds.authKeyB64;
      keys.epochKeys.set(newEpochNumber, {
        key: await importAesKey(newEpochRaw),
        raw: newEpochRaw,
      });
      keys.currentEpoch = newEpochNumber;
      keys.cryptoVersion += 1;
      setRoomKeys(roomId, keys);
      setPasswordStale(false);
      await sendSystemMessage("password-changed");
    },
    [roomId, roomPublic, sendSystemMessage],
  );

  const leaveRoom = React.useCallback(async () => {
    if (!meRef.current) return;
    try {
      await api.removeMember(roomId, meRef.current.memberId);
    } finally {
      teardownRealtime();
      clearRoomKeys(roomId);
    }
  }, [roomId, teardownRealtime]);

  const retryCheck = React.useCallback(() => {
    setFatal(null);
    setPhase("checking");
    setCheckNonce((n) => n + 1);
  }, []);

  const typingNames = React.useMemo(() => {
    const names: string[] = [];
    for (const id of typingIds.keys()) {
      const member = members.find((m) => m.memberId === id);
      if (member?.name) names.push(member.name);
    }
    return names;
  }, [typingIds, members]);

  const value: RoomContextValue = {
    roomId,
    phase,
    fatal,
    roomPublic,
    roomName,
    members,
    me,
    myName,
    messages,
    hasMore,
    loadingOlder,
    connection,
    typingNames,
    passwordStale,
    expiresAt: roomPublic?.expiresAt ?? null,
    locked: roomPublic?.locked ?? false,
    unlockError,
    unlockBusy,
    joinBusy,
    retryCheck,
    unlock,
    join,
    sendText,
    sendAttachmentMessage,
    resend,
    loadOlder,
    deleteMessage,
    notifyTyping,
    removeMember,
    banMember,
    lockRoom,
    clearAllMessages,
    destroyRoom,
    rotateKey,
    changePassword,
    leaveRoom,
  };

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}
