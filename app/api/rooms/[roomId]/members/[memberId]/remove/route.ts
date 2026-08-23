import { requireMember } from "@/lib/server/auth";
import {
  ApiError,
  handleApiError,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from "@/lib/server/http";
import { logOp } from "@/lib/server/log";
import { triggerRoomEvent } from "@/lib/server/pusher";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom, updateRoomMeta } from "@/lib/server/rooms";
import { memberIdSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Removes a member. The owner can remove anyone but themselves; a member can
 * remove (leave) only themselves. Removal frees the slot and instantly
 * invalidates every session of that member.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ roomId: string; memberId: string }> },
) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const params = await ctx.params;
    const roomId = validateRoomId(params.roomId);
    if (!memberIdSchema.safeParse(params.memberId).success) {
      return jsonError(404, "member_not_found");
    }
    const targetId = params.memberId;

    const { meta } = await requireLiveRoom(roomId);
    const authed = await requireMember(req, meta);

    const isSelf = authed.member.memberId === targetId;
    if (!isSelf && authed.member.role !== "owner") {
      return jsonError(403, "forbidden");
    }

    await updateRoomMeta(roomId, (m) => {
      const target = m.members.find((mm) => mm.memberId === targetId);
      if (!target) throw new ApiError(404, "member_not_found");
      if (target.role === "owner") {
        // The owner cannot be removed; destroying the room is the exit path.
        throw new ApiError(403, "forbidden");
      }
      m.members = m.members.filter((mm) => mm.memberId !== targetId);
      return m;
    });

    await triggerRoomEvent(roomId, "member-removed", { memberId: targetId });
    logOp({
      op: isSelf ? "member.leave" : "member.remove",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error, "member.remove");
  }
}
