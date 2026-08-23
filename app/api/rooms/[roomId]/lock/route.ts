import { requireOwner } from "@/lib/server/auth";
import {
  handleApiError,
  jsonOk,
  requireSameOrigin,
} from "@/lib/server/http";
import { logOp } from "@/lib/server/log";
import { triggerRoomEvent } from "@/lib/server/pusher";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom, updateRoomMeta } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Owner locks the room: no new members can join. */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  try {
    requireSameOrigin(req);
    const roomId = validateRoomId((await ctx.params).roomId);
    const { meta } = await requireLiveRoom(roomId);
    await requireOwner(req, meta);
    await updateRoomMeta(roomId, (m) => {
      m.locked = true;
      return m;
    });
    await triggerRoomEvent(roomId, "room-locked", {});
    logOp({ op: "room.lock", roomId, status: 200 });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error, "room.lock");
  }
}
