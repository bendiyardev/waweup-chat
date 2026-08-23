import { requireMember } from "@/lib/server/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from "@/lib/server/http";
import { hasPusher } from "@/lib/server/env";
import { ipFingerprint } from "@/lib/server/ip";
import { authorizePresence, roomChannelName } from "@/lib/server/pusher";
import { rateLimit } from "@/lib/server/ratelimit";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  try {
    requireSameOrigin(req);
    // Realtime is disabled when Pusher is not configured; clients poll instead.
    if (!hasPusher()) return jsonError(404, "not_found");
    const roomId = validateRoomId((await ctx.params).roomId);
    const limited = rateLimit(`pusher:${ipFingerprint(req)}`, 60, 60_000);
    if (!limited.ok) return jsonError(429, "rate_limited");

    const { meta } = await requireLiveRoom(roomId);
    const authed = await requireMember(req, meta);

    const form = await req.formData();
    const socketId = form.get("socket_id");
    const channelName = form.get("channel_name");
    if (typeof socketId !== "string" || typeof channelName !== "string") {
      return jsonError(400, "invalid_request");
    }
    if (!/^[\d.]{3,64}$/.test(socketId)) {
      return jsonError(400, "invalid_request");
    }
    // Members may only ever subscribe to their own room's channel.
    if (channelName !== roomChannelName(roomId)) {
      return jsonError(403, "forbidden");
    }

    const auth = authorizePresence(
      socketId,
      channelName,
      authed.member.memberId,
    );
    return jsonOk(auth);
  } catch (error) {
    return handleApiError(error, "pusher.auth");
  }
}
