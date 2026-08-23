"use client";

import Pusher from "pusher-js";

/**
 * One Pusher connection per room page. Auth goes through our cookie-based
 * endpoint; the client only ever sees the public key.
 */
export function createRoomPusher(roomId: string): Pusher | null {
  const key = process.env.NEXT_PUBLIC_PUSHER_KEY;
  const cluster = process.env.NEXT_PUBLIC_PUSHER_CLUSTER;
  if (!key || !cluster) return null;
  return new Pusher(key, {
    cluster,
    channelAuthorization: {
      transport: "ajax",
      endpoint: `/api/rooms/${roomId}/pusher/auth`,
    },
    enabledTransports: ["ws", "wss"],
    disableStats: true,
  });
}

export function roomChannel(roomId: string): string {
  return `presence-room-${roomId}`;
}
