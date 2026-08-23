import { fromB64Url } from "@/lib/crypto/encoding";
import { requireOwner, sha256B64UrlSync } from "@/lib/server/auth";
import {
  ApiError,
  handleApiError,
  jsonOk,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/http";
import { logOp } from "@/lib/server/log";
import { triggerRoomEvent } from "@/lib/server/pusher";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom, updateRoomMeta } from "@/lib/server/rooms";
import { changePasswordSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner changes the room password. The browser derives a fresh master key
 * from the new password, re-wraps every historical epoch key under the new
 * KEK and starts a new epoch, then submits everything in one atomic,
 * versioned update. The old password can no longer unlock the room or read
 * anything sent after the change; history remains readable to holders of the
 * new password.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const roomId = validateRoomId((await ctx.params).roomId);
    const { meta } = await requireLiveRoom(roomId);
    await requireOwner(req, meta);
    const body = await readJsonBody(req, changePasswordSchema, 256 * 1024);

    const updated = await updateRoomMeta(roomId, (m) => {
      // The submitted epoch set must cover every existing epoch exactly once
      // plus exactly one new epoch — otherwise history would silently break.
      const submitted = new Map(body.epochs.map((e) => [e.epoch, e]));
      if (submitted.size !== body.epochs.length) {
        throw new ApiError(400, "invalid_request");
      }
      for (const existing of m.crypto.epochs) {
        if (!submitted.has(existing.epoch)) {
          throw new ApiError(409, "epoch_conflict");
        }
      }
      if (
        body.currentEpoch !== m.crypto.currentEpoch + 1 ||
        !submitted.has(body.currentEpoch) ||
        submitted.size !== m.crypto.epochs.length + 1
      ) {
        throw new ApiError(409, "epoch_conflict");
      }

      const now = new Date().toISOString();
      const createdAtByEpoch = new Map(
        m.crypto.epochs.map((e) => [e.epoch, e.createdAt]),
      );
      m.crypto = {
        ...m.crypto,
        salt: body.salt,
        kdf: body.kdf,
        verifierHash: sha256B64UrlSync(fromB64Url(body.authKey)),
        currentEpoch: body.currentEpoch,
        epochs: body.epochs
          .slice()
          .sort((a, b) => a.epoch - b.epoch)
          .map((e) => ({
            epoch: e.epoch,
            wrappedKey: e.wrappedKey,
            createdAt: createdAtByEpoch.get(e.epoch) ?? now,
          })),
        cryptoVersion: m.crypto.cryptoVersion + 1,
      };
      return m;
    });

    await triggerRoomEvent(roomId, "crypto-rotated", {
      cryptoVersion: updated.crypto.cryptoVersion,
      passwordChanged: true,
    });
    logOp({
      op: "room.change-password",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({
      currentEpoch: updated.crypto.currentEpoch,
      cryptoVersion: updated.crypto.cryptoVersion,
    });
  } catch (error) {
    return handleApiError(error, "room.change-password");
  }
}
