import { NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/config";
import { generateMemberId, generateMemberToken } from "@/lib/crypto/ids";
import {
  authenticateMember,
  setSessionCookie,
  sha256B64UrlSync,
  signSession,
  verifyUnlockToken,
} from "@/lib/server/auth";
import {
  ApiError,
  handleApiError,
  jsonError,
  jsonOk,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/http";
import { ipFingerprint } from "@/lib/server/ip";
import { logOp } from "@/lib/server/log";
import { rateLimit } from "@/lib/server/ratelimit";
import { validateRoomId } from "@/lib/server/room-route";
import { toMaterial } from "@/lib/server/room-views";
import { requireLiveRoom, updateRoomMeta } from "@/lib/server/rooms";
import { joinSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const roomId = validateRoomId((await ctx.params).roomId);
    const fp = ipFingerprint(req);
    const limited = rateLimit(`join:${fp}`, 20, 5 * 60_000);
    if (!limited.ok) return jsonError(429, "rate_limited");

    const { meta } = await requireLiveRoom(roomId);
    const body = await readJsonBody(req, joinSchema);

    // Existing member: this call sets the display name chosen after unlock.
    const authed = await authenticateMember(req, meta);
    if (authed) {
      const updated = await updateRoomMeta(roomId, (m) => {
        const member = m.members.find(
          (mm) => mm.memberId === authed.member.memberId,
        );
        if (!member) throw new ApiError(401, "unauthorized");
        member.encryptedDisplayName = body.encryptedDisplayName;
        member.displayNameEpoch = body.displayNameEpoch;
        return m;
      });
      return jsonOk({
        memberId: authed.member.memberId,
        role: authed.member.role,
        material: toMaterial(updated),
      });
    }

    // New member: requires a fresh proof of password knowledge.
    if (!body.unlockToken || !(await verifyUnlockToken(body.unlockToken, roomId))) {
      return jsonError(401, "unauthorized");
    }
    if (meta.bannedIpHmacs.includes(fp)) {
      return jsonError(403, "banned", "You cannot join this chat");
    }
    if (meta.locked) {
      return jsonError(403, "room_locked", "This chat is locked");
    }

    const memberId = generateMemberId();
    const memberToken = generateMemberToken();
    const now = new Date().toISOString();

    const updated = await updateRoomMeta(roomId, (m) => {
      if (m.locked) throw new ApiError(403, "room_locked");
      if (m.bannedIpHmacs.includes(fp)) throw new ApiError(403, "banned");
      if (m.members.length >= APP_CONFIG.maxMembers) {
        throw new ApiError(403, "room_full", "This private chat is full");
      }
      m.members.push({
        memberId,
        role: "member",
        tokenHash: sha256B64UrlSync(memberToken),
        encryptedDisplayName: body.encryptedDisplayName,
        displayNameEpoch: body.displayNameEpoch,
        joinedAt: now,
        sessionVersion: 1,
        ipHmac: fp,
      });
      return m;
    });

    const session = await signSession(
      { rid: roomId, mid: memberId, tok: memberToken, sv: 1 },
      new Date(updated.expiresAt),
    );
    const res = NextResponse.json(
      {
        memberId,
        role: "member",
        material: toMaterial(updated),
      },
      { status: 201, headers: { "Cache-Control": "no-store" } },
    );
    setSessionCookie(res, roomId, session.token, session.maxAgeSeconds);
    logOp({
      op: "room.join",
      roomId,
      status: 201,
      durationMs: Date.now() - start,
    });
    return res;
  } catch (error) {
    return handleApiError(error, "room.join");
  }
}
