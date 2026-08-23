import { ULID_REGEX } from "@/lib/crypto/ids";
import { requireMember } from "@/lib/server/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from "@/lib/server/http";
import { logOp } from "@/lib/server/log";
import { deleteMessage, getMessage } from "@/lib/server/messages";
import { triggerRoomEvent } from "@/lib/server/pusher";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Delete one message: authors may delete their own, the owner may delete any. */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ roomId: string; messageId: string }> },
) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const params = await ctx.params;
    const roomId = validateRoomId(params.roomId);
    const messageId = params.messageId;
    if (!ULID_REGEX.test(messageId)) {
      return jsonError(404, "message_not_found");
    }
    const { meta } = await requireLiveRoom(roomId);
    const authed = await requireMember(req, meta);

    const envelope = await getMessage(roomId, messageId);
    if (!envelope) return jsonError(404, "message_not_found");
    if (
      authed.member.role !== "owner" &&
      envelope.memberId !== authed.member.memberId
    ) {
      return jsonError(403, "forbidden");
    }

    await deleteMessage(roomId, messageId);
    await triggerRoomEvent(roomId, "message-deleted", { messageId });
    logOp({
      op: "message.delete",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error, "message.delete");
  }
}
