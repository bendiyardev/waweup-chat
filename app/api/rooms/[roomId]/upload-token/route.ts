import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/config";
import { requireMember } from "@/lib/server/auth";
import {
  ApiError,
  handleApiError,
  jsonError,
  requireSameOrigin,
} from "@/lib/server/http";
import { ipFingerprint } from "@/lib/server/ip";
import { chunkPath } from "@/lib/server/paths";
import { rateLimit } from "@/lib/server/ratelimit";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom } from "@/lib/server/rooms";
import { uploadClientPayloadSchema } from "@/lib/validation/schemas";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CHUNK_OVERHEAD = 64; // IV + GCM tag + slack
const MAX_FILE_CHUNKS = Math.ceil(
  APP_CONFIG.maxFileBytes / APP_CONFIG.attachmentChunkBytes,
);
const MAX_VOICE_CHUNKS = Math.ceil(
  APP_CONFIG.maxVoiceBytes / APP_CONFIG.attachmentChunkBytes,
);

/**
 * Issues short-lived, tightly-scoped client upload tokens so encrypted chunks
 * go directly from the browser to Vercel Blob without transiting a function
 * body. The blob read-write token itself never reaches the client.
 */
export async function POST(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  try {
    const roomId = validateRoomId((await ctx.params).roomId);
    const body = (await req.json()) as HandleUploadBody;

    if (body.type === "blob.generate-client-token") {
      // Token issuance is a user-initiated cookie-authenticated mutation.
      requireSameOrigin(req);
      const limited = rateLimit(`upload:${ipFingerprint(req)}`, 120, 60_000);
      if (!limited.ok) return jsonError(429, "rate_limited");
      const { meta } = await requireLiveRoom(roomId);
      await requireMember(req, meta);
    }
    // "blob.upload-completed" callbacks come from Vercel and are verified by
    // handleUpload's signature check; they carry no session cookie.

    const result = await handleUpload({
      request: req,
      body,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!clientPayload) throw new ApiError(400, "invalid_request");
        let parsed: unknown;
        try {
          parsed = JSON.parse(clientPayload);
        } catch {
          throw new ApiError(400, "invalid_request");
        }
        const payload = uploadClientPayloadSchema.safeParse(parsed);
        if (!payload.success) throw new ApiError(400, "invalid_request");
        const { attachmentId, chunkIndex, voice } = payload.data;

        const maxChunks = voice ? MAX_VOICE_CHUNKS : MAX_FILE_CHUNKS;
        if (chunkIndex > maxChunks) {
          throw new ApiError(400, "file_too_large");
        }
        // The client may only write the exact chunk object it declared.
        const expected = chunkPath(roomId, attachmentId, chunkIndex);
        if (pathname !== expected) {
          throw new ApiError(403, "forbidden");
        }
        return {
          allowedContentTypes: ["application/octet-stream"],
          maximumSizeInBytes:
            APP_CONFIG.attachmentChunkBytes + CHUNK_OVERHEAD,
          addRandomSuffix: false,
          allowOverwrite: true,
          validUntil: Date.now() + 10 * 60 * 1000,
        };
      },
      onUploadCompleted: async () => {
        // Nothing to do: the attachment message references the chunks and the
        // client verifies chunk integrity via AES-GCM on download.
      },
    });

    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    return handleApiError(error, "upload.token");
  }
}
