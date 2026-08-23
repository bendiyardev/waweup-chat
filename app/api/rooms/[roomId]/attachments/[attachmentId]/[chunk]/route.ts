import { ATTACHMENT_ID_REGEX } from "@/lib/crypto/ids";
import { requireMember } from "@/lib/server/auth";
import { getStore } from "@/lib/server/blob";
import { handleApiError, jsonError } from "@/lib/server/http";
import { chunkPath } from "@/lib/server/paths";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Streams one encrypted attachment chunk to an authenticated member. Blobs
 * are private, so all reads are authorized here; the payload is ciphertext
 * that only room key holders can open.
 */
export async function GET(
  req: Request,
  ctx: {
    params: Promise<{ roomId: string; attachmentId: string; chunk: string }>;
  },
) {
  try {
    const params = await ctx.params;
    const roomId = validateRoomId(params.roomId);
    if (!ATTACHMENT_ID_REGEX.test(params.attachmentId)) {
      return jsonError(404, "not_found");
    }
    const chunkIndex = Number(params.chunk);
    if (!Number.isInteger(chunkIndex) || chunkIndex < 1 || chunkIndex > 100_000) {
      return jsonError(404, "not_found");
    }

    const { meta } = await requireLiveRoom(roomId);
    await requireMember(req, meta);

    const result = await getStore().readBytes(
      chunkPath(roomId, params.attachmentId, chunkIndex),
    );
    if (!result) return jsonError(404, "not_found");

    return new Response(new Uint8Array(result.bytes), {
      status: 200,
      headers: {
        "Content-Type": "application/octet-stream",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return handleApiError(error, "attachment.chunk");
  }
}
