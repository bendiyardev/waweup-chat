import { APP_CONFIG } from "@/lib/config";
import { toDescendingKey } from "@/lib/crypto/ids";
import type { ListMessagesResult, MessageEnvelope } from "@/types/message";
import { getStore, StoreConflictError } from "./blob";
import { ApiError } from "./http";
import { attachmentPrefix, messagePath, messagesPrefix } from "./paths";
import { deletePrefix } from "./rooms";

/** Persists a message envelope as an immutable object (create-only). */
export async function putMessage(envelope: MessageEnvelope): Promise<void> {
  try {
    await getStore().writeJson(
      messagePath(envelope.roomId, envelope.messageId),
      envelope,
      { createOnly: true },
    );
  } catch (error) {
    if (error instanceof StoreConflictError) {
      throw new ApiError(409, "duplicate_message");
    }
    throw error;
  }
}

async function readEnvelopes(
  pathnames: string[],
): Promise<MessageEnvelope[]> {
  const store = getStore();
  const out: MessageEnvelope[] = [];
  // Bounded parallelism keeps memory and connection usage sane.
  const parallel = 8;
  for (let i = 0; i < pathnames.length; i += parallel) {
    const batch = pathnames.slice(i, i + parallel);
    const results = await Promise.all(
      batch.map((p) => store.readJson<MessageEnvelope>(p)),
    );
    for (const result of results) {
      if (result) out.push(result.data);
    }
  }
  return out;
}

/**
 * Lists messages newest-first. `cursor` continues an older page (opaque blob
 * cursor); `afterId` returns only messages newer than the given message —
 * used for reconciliation after a realtime gap.
 */
export async function listMessages(
  roomId: string,
  options: { cursor?: string; afterId?: string; limit?: number },
): Promise<ListMessagesResult> {
  const store = getStore();
  const limit = Math.min(
    options.limit ?? APP_CONFIG.historyPageSize,
    APP_CONFIG.historyPageSize,
  );
  const prefix = messagesPrefix(roomId);

  if (options.afterId) {
    // Messages newer than afterId sort strictly BEFORE its descending key.
    const boundary = `${prefix}${toDescendingKey(options.afterId)}`;
    const pathnames: string[] = [];
    let cursor: string | undefined;
    let truncated = false;
    for (let i = 0; i < 20 && !truncated; i++) {
      const page = await store.list(prefix, { cursor, limit: 200 });
      for (const blob of page.blobs) {
        if (blob.pathname >= boundary) {
          truncated = true;
          break;
        }
        pathnames.push(blob.pathname);
        if (pathnames.length >= 200) {
          truncated = true;
          break;
        }
      }
      if (!page.hasMore || !page.cursor) break;
      cursor = page.cursor;
    }
    const messages = await readEnvelopes(pathnames);
    return { messages, cursor: null, hasMore: false };
  }

  const page = await store.list(prefix, {
    cursor: options.cursor,
    limit,
  });
  const messages = await readEnvelopes(page.blobs.map((b) => b.pathname));
  return {
    messages,
    cursor: page.hasMore ? page.cursor : null,
    hasMore: page.hasMore,
  };
}

export async function getMessage(
  roomId: string,
  messageId: string,
): Promise<MessageEnvelope | null> {
  const result = await getStore().readJson<MessageEnvelope>(
    messagePath(roomId, messageId),
  );
  return result?.data ?? null;
}

/** Deletes a message and, when it carried an attachment, its cipher chunks. */
export async function deleteMessage(
  roomId: string,
  messageId: string,
): Promise<{ existed: boolean }> {
  const envelope = await getMessage(roomId, messageId);
  if (!envelope) return { existed: false };
  await getStore().del([messagePath(roomId, messageId)]);
  if (envelope.attachmentId) {
    await deletePrefix(attachmentPrefix(roomId, envelope.attachmentId));
  }
  return { existed: true };
}

/** Deletes every message and attachment of a room (idempotent, paginated). */
export async function clearRoomContent(roomId: string): Promise<void> {
  await deletePrefix(messagesPrefix(roomId));
  await deletePrefix(`rooms/${roomId}/files/`);
}
