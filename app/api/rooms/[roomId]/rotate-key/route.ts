import { requireOwner } from "@/lib/server/auth";
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
import { rotateKeySchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner starts a new key epoch. The new random epoch key is generated in the
 * owner's browser and arrives here only in wrapped (encrypted) form. Future
 * messages use the new epoch; history stays readable under older epochs.
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
    const body = await readJsonBody(req, rotateKeySchema);

    const updated = await updateRoomMeta(roomId, (m) => {
      if (body.epoch !== m.crypto.currentEpoch + 1) {
        throw new ApiError(409, "epoch_conflict");
      }
      m.crypto.epochs.push({
        epoch: body.epoch,
        wrappedKey: body.wrappedKey,
        createdAt: new Date().toISOString(),
      });
      m.crypto.currentEpoch = body.epoch;
      m.crypto.cryptoVersion += 1;
      return m;
    });

    await triggerRoomEvent(roomId, "crypto-rotated", {
      cryptoVersion: updated.crypto.cryptoVersion,
    });
    logOp({
      op: "room.rotate-key",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ currentEpoch: updated.crypto.currentEpoch });
  } catch (error) {
    return handleApiError(error, "room.rotate-key");
  }
}
