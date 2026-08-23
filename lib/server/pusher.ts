import Pusher from "pusher";
import { isTestEnv, serverEnv } from "./env";

export function roomChannelName(roomId: string): string {
  return `presence-room-${roomId}`;
}

export type RoomEvent =
  | "message-new"
  | "message-deleted"
  | "messages-cleared"
  | "member-removed"
  | "member-banned"
  | "room-locked"
  | "room-unlocked"
  | "crypto-rotated"
  | "room-destroyed";

let client: Pusher | null = null;

function getPusher(): Pusher {
  if (!client) {
    const env = serverEnv();
    client = new Pusher({
      appId: env.PUSHER_APP_ID,
      key: env.PUSHER_KEY,
      secret: env.PUSHER_SECRET,
      cluster: env.PUSHER_CLUSTER,
      useTLS: true,
    });
  }
  return client;
}

/** Test recorder — events triggered in test mode are captured here. */
export const testEvents: {
  channel: string;
  event: string;
  data: unknown;
}[] = [];

/**
 * Triggers a realtime event on the room channel. Payloads only ever contain
 * ciphertext envelopes or technical IDs — never plaintext content. Pusher
 * outages must not break persistence, so failures are logged and swallowed.
 */
export async function triggerRoomEvent(
  roomId: string,
  event: RoomEvent,
  data: unknown,
): Promise<void> {
  const channel = roomChannelName(roomId);
  if (isTestEnv()) {
    testEvents.push({ channel, event, data });
    return;
  }
  try {
    await getPusher().trigger(channel, event, data);
  } catch {
    console.error(
      JSON.stringify({ op: "pusher.trigger", status: "error", event }),
    );
  }
}

/** Authorizes a presence channel subscription for an authenticated member. */
export function authorizePresence(
  socketId: string,
  channel: string,
  memberId: string,
): { auth: string; channel_data?: string } {
  if (isTestEnv()) {
    return { auth: "test:auth" };
  }
  return getPusher().authorizeChannel(socketId, channel, {
    user_id: memberId,
    // No user_info on purpose: presence must never carry plaintext names.
    user_info: {},
  });
}
