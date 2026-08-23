import { authenticateMember, requireOwner } from "@/lib/server/auth";
import { handleApiError, jsonOk, requireSameOrigin } from "@/lib/server/http";
import { logOp } from "@/lib/server/log";
import { triggerRoomEvent } from "@/lib/server/pusher";
import { validateRoomId } from "@/lib/server/room-route";
import { toMaterial, toPublicInfo } from "@/lib/server/room-views";
import { deleteRoomData, requireLiveRoom } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  try {
    const roomId = validateRoomId((await ctx.params).roomId);
    const { meta } = await requireLiveRoom(roomId);
    const authed = await authenticateMember(req, meta);
    if (!authed) {
      return jsonOk({ room: toPublicInfo(meta), session: null });
    }
    return jsonOk({
      room: toPublicInfo(meta),
      session: {
        memberId: authed.member.memberId,
        role: authed.member.role,
        hasDisplayName: authed.member.encryptedDisplayName !== null,
      },
      material: toMaterial(meta),
    });
  } catch (error) {
    return handleApiError(error, "room.get");
  }
}

/** Owner permanently destroys the room and every object it owns. */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const roomId = validateRoomId((await ctx.params).roomId);
    const { meta } = await requireLiveRoom(roomId);
    await requireOwner(req, meta);
    // Notify live clients first; deletion may take a few seconds.
    await triggerRoomEvent(roomId, "room-destroyed", {});
    await deleteRoomData(roomId);
    logOp({
      op: "room.destroy",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error, "room.destroy");
  }
}
