import { requireOwner } from "@/lib/server/auth";
import {
  ApiError,
  handleApiError,
  jsonError,
  jsonOk,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/http";
import { logOp } from "@/lib/server/log";
import { triggerRoomEvent } from "@/lib/server/pusher";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom, updateRoomMeta } from "@/lib/server/rooms";
import { banSchema, memberIdSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner bans a member: their token hash is blacklisted, their sessions are
 * revoked, and optionally their IP fingerprint (keyed HMAC, never a raw IP)
 * is blocked from rejoining. A ban is best-effort by design — someone on a
 * new network can present a new fingerprint.
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
    await requireOwner(req, meta);
    const body = await readJsonBody(req, banSchema);

    await updateRoomMeta(roomId, (m) => {
      const target = m.members.find((mm) => mm.memberId === targetId);
      if (!target) throw new ApiError(404, "member_not_found");
      if (target.role === "owner") throw new ApiError(403, "forbidden");
      m.bannedTokenHashes.push(target.tokenHash);
      if (body.banIp && target.ipHmac && target.ipHmac.length > 0) {
        if (!m.bannedIpHmacs.includes(target.ipHmac)) {
          m.bannedIpHmacs.push(target.ipHmac);
        }
      }
      m.members = m.members.filter((mm) => mm.memberId !== targetId);
      return m;
    });

    await triggerRoomEvent(roomId, "member-banned", { memberId: targetId });
    logOp({
      op: "member.ban",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error, "member.ban");
  }
}
