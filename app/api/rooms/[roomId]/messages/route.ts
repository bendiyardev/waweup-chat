import { APP_CONFIG } from "@/lib/config";
import { ULID_REGEX } from "@/lib/crypto/ids";
import { requireMember, requireOwner } from "@/lib/server/auth";
import {
  handleApiError,
  jsonError,
  jsonOk,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/http";
import { ipFingerprint } from "@/lib/server/ip";
import { logOp } from "@/lib/server/log";
import {
  clearRoomContent,
  listMessages,
  putMessage,
} from "@/lib/server/messages";
import { triggerRoomEvent } from "@/lib/server/pusher";
import { rateLimit } from "@/lib/server/ratelimit";
import { validateRoomId } from "@/lib/server/room-route";
import { requireLiveRoom } from "@/lib/server/rooms";
import { sendMessageSchema } from "@/lib/validation/schemas";
import type { MessageEnvelope } from "@/types/message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  try {
    const roomId = validateRoomId((await ctx.params).roomId);
    const { meta } = await requireLiveRoom(roomId);
    await requireMember(req, meta);

    const url = new URL(req.url);
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const after = url.searchParams.get("after") ?? undefined;
    if (after && !ULID_REGEX.test(after)) {
      return jsonError(400, "invalid_request");
    }
    if (cursor && cursor.length > 4096) {
      return jsonError(400, "invalid_request");
    }
    const result = await listMessages(roomId, { cursor, afterId: after });
    return jsonOk(result);
  } catch (error) {
    return handleApiError(error, "messages.list");
  }
}

export async function POST(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const roomId = validateRoomId((await ctx.params).roomId);
    const limited = rateLimit(`send:${ipFingerprint(req)}`, 60, 30_000);
    if (!limited.ok) return jsonError(429, "rate_limited");

    const { meta } = await requireLiveRoom(roomId);
    const authed = await requireMember(req, meta);
    const body = await readJsonBody(
      req,
      sendMessageSchema,
      Math.ceil((APP_CONFIG.maxMessageCiphertextBytes * 4) / 3) + 4096,
    );

    if (body.keyEpoch > meta.crypto.currentEpoch) {
      return jsonError(400, "invalid_epoch");
    }

    const envelope: MessageEnvelope = {
      protocolVersion: 1,
      roomId,
      messageId: body.messageId,
      // Identity always comes from the session, never from the client body.
      memberId: authed.member.memberId,
      kind: body.kind,
      keyEpoch: body.keyEpoch,
      createdAt: new Date().toISOString(),
      ...(body.attachmentId ? { attachmentId: body.attachmentId } : {}),
      iv: body.iv,
      ct: body.ct,
    };

    await putMessage(envelope);
    // Pusher rejects payloads over 10 KB. Large envelopes are announced by
    // ID only; clients then pull the ciphertext via the reconciliation API.
    const eventPayload = { envelope };
    if (JSON.stringify(eventPayload).length > 8_000) {
      await triggerRoomEvent(roomId, "message-new", {
        messageId: envelope.messageId,
      });
    } else {
      await triggerRoomEvent(roomId, "message-new", eventPayload);
    }
    logOp({
      op: "message.send",
      roomId,
      status: 201,
      durationMs: Date.now() - start,
    });
    return jsonOk({ messageId: envelope.messageId, createdAt: envelope.createdAt }, { status: 201 });
  } catch (error) {
    return handleApiError(error, "message.send");
  }
}

/** Owner: clear all messages and attachments. The room itself stays open. */
export async function DELETE(
  req: Request,
  ctx: { params: Promise<{ roomId: string }> },
) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const roomId = validateRoomId((await ctx.params).roomId);
    const { meta } = await requireLiveRoom(roomId);
    await requireOwner(req, meta);
    await clearRoomContent(roomId);
    await triggerRoomEvent(roomId, "messages-cleared", {});
    logOp({
      op: "messages.clear",
      roomId,
      status: 200,
      durationMs: Date.now() - start,
    });
    return jsonOk({ ok: true });
  } catch (error) {
    return handleApiError(error, "messages.clear");
  }
}
