import { NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/config";
import { fromB64Url } from "@/lib/crypto/encoding";
import { generateMemberToken } from "@/lib/crypto/ids";
import {
  authenticateMember,
  safeEqual,
  setSessionCookie,
  sha256B64UrlSync,
  signSession,
  signUnlockToken,
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
import {
  clearUnlockFailures,
  rateLimit,
  registerUnlockFailure,
  unlockCooldownSeconds,
} from "@/lib/server/ratelimit";
import { validateRoomId } from "@/lib/server/room-route";
import { toMaterial } from "@/lib/server/room-views";
import { requireLiveRoom, updateRoomMeta } from "@/lib/server/rooms";
import { unlockSchema } from "@/lib/validation/schemas";

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

    const limited = rateLimit(`unlock:${fp}`, 30, 5 * 60_000);
    if (!limited.ok) {
      return jsonError(429, "rate_limited", "Too many attempts", );
    }
    const cooldownKey = `${roomId}:${fp}`;
    const cooldown = unlockCooldownSeconds(cooldownKey);
    if (cooldown > 0) {
      const res = jsonError(429, "cooldown", "Too many failed attempts");
      res.headers.set("Retry-After", String(cooldown));
      return res;
    }

    const { meta } = await requireLiveRoom(roomId);
    const body = await readJsonBody(req, unlockSchema);

    const verifier = sha256B64UrlSync(fromB64Url(body.authKey));
    if (!safeEqual(verifier, meta.crypto.verifierHash)) {
      registerUnlockFailure(cooldownKey);
      logOp({ op: "room.unlock", roomId, status: 401 });
      // Deliberately generic — no hints about the room.
      return jsonError(401, "invalid_password", "Invalid room password");
    }
    clearUnlockFailures(cooldownKey);

    const authed = await authenticateMember(req, meta);
    if (authed) {
      return jsonOk({
        material: toMaterial(meta),
        session: {
          memberId: authed.member.memberId,
          role: authed.member.role,
          hasDisplayName: authed.member.encryptedDisplayName !== null,
        },
      });
    }

    // Owner recovery: re-establish the owner session with the recovery key.
    if (body.recoveryKey) {
      const recoveryHash = sha256B64UrlSync(fromB64Url(body.recoveryKey));
      if (safeEqual(recoveryHash, meta.ownerRecoveryHash)) {
        // Rotate the owner's bearer token: the recovery key proves ownership,
        // so bind a fresh token and revoke every previous owner session.
        const newToken = generateMemberToken();
        const updated = await updateRoomMeta(roomId, (m) => {
          const owner = m.members.find((mm) => mm.role === "owner");
          if (!owner) throw new ApiError(409, "conflict");
          owner.tokenHash = sha256B64UrlSync(newToken);
          owner.sessionVersion += 1;
          return m;
        });
        const owner = updated.members.find((m) => m.role === "owner");
        if (owner) {
          const session = await signSession(
            {
              rid: roomId,
              mid: owner.memberId,
              tok: newToken,
              sv: owner.sessionVersion,
            },
            new Date(updated.expiresAt),
          );
          const res = NextResponse.json(
            {
              material: toMaterial(updated),
              session: {
                memberId: owner.memberId,
                role: owner.role,
                hasDisplayName: owner.encryptedDisplayName !== null,
              },
              recovered: true,
            },
            { status: 200, headers: { "Cache-Control": "no-store" } },
          );
          setSessionCookie(res, roomId, session.token, session.maxAgeSeconds);
          return res;
        }
      }
      return jsonError(401, "invalid_recovery_key", "Invalid recovery key");
    }

    if (meta.locked) {
      return jsonOk({ locked: true });
    }
    if (meta.members.length >= APP_CONFIG.maxMembers) {
      return jsonOk({ full: true });
    }

    const unlockToken = await signUnlockToken(roomId);
    logOp({
      op: "room.unlock",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ unlockToken, material: toMaterial(meta), session: null });
  } catch (error) {
    return handleApiError(error, "room.unlock");
  }
}
