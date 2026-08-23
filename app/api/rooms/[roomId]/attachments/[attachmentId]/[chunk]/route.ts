import { APP_CONFIG } from "@/lib/config";
import { ATTACHMENT_ID_REGEX } from "@/lib/crypto/ids";
import { requireMember } from "@/lib/server/auth";
import { getStore, StoreConflictError } from "@/lib/server/blob";
import {
  handleApiError,
  jsonError,
  jsonOk,
  requireSameOrigin,
} from "@/lib/server/http";
import { ipFingerprint } from "@/lib/server/ip";
import { chunkPath } from "@/lib/server/paths";
import { rateLimit } from "@/lib/server/ratelimit";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom } from "@/lib/server/rooms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// AES-GCM adds a 12-byte IV + 16-byte tag; allow a little slack.
const MAX_CHUNK_BYTES = APP_CONFIG.attachmentChunkBytes + 1024;

function parseChunkParams(params: {
  roomId: string;
  attachmentId: string;
  chunk: string;
}): { roomId: string; attachmentId: string; chunkIndex: number } | null {
  const roomId = validateRoomId(params.roomId);
  if (!ATTACHMENT_ID_REGEX.test(params.attachmentId)) return null;
  const chunkIndex = Number(params.chunk);
  if (!Number.isInteger(chunkIndex) || chunkIndex < 1 || chunkIndex > 100_000) {
    return null;
  }
  return { roomId, attachmentId: params.attachmentId, chunkIndex };
}

/**
 * Stores one encrypted attachment chunk. The ciphertext is proxied through the
 * server (chunks are ≤ 3 MB) and written with the server-only blob token, which
 * is far more reliable than the direct client-upload token flow. A member may
 * only ever write the exact chunk object of the room they are in, once.
 */
export async function PUT(
  req: Request,
  ctx: {
    params: Promise<{ roomId: string; attachmentId: string; chunk: string }>;
  },
) {
  try {
    requireSameOrigin(req);
    const parsed = parseChunkParams(await ctx.params);
    if (!parsed) return jsonError(404, "not_found");
    const { roomId, attachmentId, chunkIndex } = parsed;

    const limited = rateLimit(`chunk:${ipFingerprint(req)}`, 400, 60_000);
    if (!limited.ok) return jsonError(429, "rate_limited");

    const { meta } = await requireLiveRoom(roomId);
    await requireMember(req, meta);

    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength === 0 || body.byteLength > MAX_CHUNK_BYTES) {
      return jsonError(400, "invalid_request");
    }

    try {
      await getStore().writeBytes(
        chunkPath(roomId, attachmentId, chunkIndex),
        body,
        { createOnly: true },
      );
    } catch (error) {
      // A duplicate chunk write is harmless — the object already exists.
      if (!(error instanceof StoreConflictError)) throw error;
    }

    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error, "attachment.upload");
  }
}

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
