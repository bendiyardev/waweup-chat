"use client";

import { APP_CONFIG } from "@/lib/config";
import { generateAttachmentId } from "@/lib/crypto/ids";
import type { AttachmentMeta } from "@/types/message";
import { api } from "./api";
import { getCurrentEpochKey, getEpochKey } from "./keystore";
import { workerDecryptChunk, workerEncryptChunk } from "./worker-client";

export interface UploadProgress {
  phase: "encrypting" | "uploading" | "done";
  /** 0..100 across the whole attachment. */
  percent: number;
}

export class UploadCancelledError extends Error {
  constructor() {
    super("Upload cancelled");
    this.name = "UploadCancelledError";
  }
}

/**
 * Encrypts a file chunk-by-chunk in the crypto worker and uploads each
 * encrypted chunk directly to Vercel Blob using short-lived scoped tokens.
 * Plaintext never leaves the browser; the server only ever sees ciphertext.
 */
export async function encryptAndUploadFile(
  roomId: string,
  file: File | Blob,
  options: {
    voice?: boolean;
    signal?: AbortSignal;
    onProgress?: (progress: UploadProgress) => void;
  } = {},
): Promise<{ attachment: Omit<AttachmentMeta, "name" | "mime"> ; attachmentId: string; keyEpoch: number }> {
  const epochLookup = getCurrentEpochKey(roomId);
  if (!epochLookup) throw new Error("Room keys unavailable");
  const epochEntry = epochLookup;
  const attachmentId = generateAttachmentId();
  const chunkSize = APP_CONFIG.attachmentChunkBytes;
  const chunkCount = Math.max(1, Math.ceil(file.size / chunkSize));

  const maxBytes = options.voice
    ? APP_CONFIG.maxVoiceBytes
    : APP_CONFIG.maxFileBytes;
  if (file.size > maxBytes) throw new Error("File too large");

  let completed = 0;
  const report = (phase: UploadProgress["phase"], fraction: number) => {
    options.onProgress?.({
      phase,
      percent: Math.round(fraction * 100),
    });
  };

  // Bounded parallelism: encrypt + upload a few chunks at a time to keep
  // memory flat even for 100 MB files.
  const indices = Array.from({ length: chunkCount }, (_, i) => i + 1);
  const parallelism = APP_CONFIG.attachmentParallelism;
  let cursor = 0;

  async function processNext(): Promise<void> {
    while (cursor < indices.length) {
      if (options.signal?.aborted) throw new UploadCancelledError();
      const index = indices[cursor++];
      if (index === undefined) return;
      const start = (index - 1) * chunkSize;
      const slice = file.slice(start, Math.min(start + chunkSize, file.size));
      const plain = new Uint8Array(await slice.arrayBuffer());
      const encrypted = await workerEncryptChunk(
        epochEntry.raw,
        roomId,
        attachmentId,
        index,
        plain,
      );
      if (options.signal?.aborted) throw new UploadCancelledError();
      // Ciphertext is proxied through our own route (chunks are <= 3 MB) and
      // written server-side with the blob RW token — reliable and CSP-simple.
      const res = await fetch(
        `/api/rooms/${roomId}/attachments/${attachmentId}/${index}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/octet-stream" },
          body: encrypted.slice().buffer as ArrayBuffer,
          credentials: "same-origin",
          cache: "no-store",
          signal: options.signal,
        },
      );
      if (!res.ok) throw new Error(`Chunk upload failed (${res.status})`);
      completed += 1;
      report("uploading", completed / chunkCount);
    }
  }

  report("encrypting", 0);
  try {
    await Promise.all(
      Array.from({ length: Math.min(parallelism, chunkCount) }, () =>
        processNext(),
      ),
    );
  } catch (error) {
    if (options.signal?.aborted) throw new UploadCancelledError();
    throw error;
  }
  report("done", 1);

  return {
    attachmentId,
    keyEpoch: epochEntry.epoch,
    attachment: {
      attachmentId,
      size: file.size,
      chunkCount,
      chunkSize,
    },
  };
}

/**
 * Downloads and decrypts an attachment into a Blob. Chunks stream through
 * the crypto worker with bounded parallelism.
 */
export async function downloadAndDecryptAttachment(
  roomId: string,
  attachment: AttachmentMeta,
  keyEpoch: number,
  options: {
    signal?: AbortSignal;
    onProgress?: (percent: number) => void;
  } = {},
): Promise<Blob> {
  const epochLookup = getEpochKey(roomId, keyEpoch);
  if (!epochLookup) throw new Error("Missing key for this attachment");
  const epochEntry = epochLookup;

  const parts: Uint8Array[] = new Array(attachment.chunkCount);
  let completed = 0;
  const indices = Array.from(
    { length: attachment.chunkCount },
    (_, i) => i + 1,
  );
  let cursor = 0;

  async function processNext(): Promise<void> {
    while (cursor < indices.length) {
      const index = indices[cursor++];
      if (index === undefined) return;
      const cipher = await api.downloadChunk(
        roomId,
        attachment.attachmentId,
        index,
        options.signal,
      );
      const plain = await workerDecryptChunk(
        epochEntry.raw,
        roomId,
        attachment.attachmentId,
        index,
        cipher,
      );
      parts[index - 1] = plain;
      completed += 1;
      options.onProgress?.(
        Math.round((completed / attachment.chunkCount) * 100),
      );
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(APP_CONFIG.attachmentParallelism, indices.length) },
      () => processNext(),
    ),
  );

  const safeMime = attachment.mime.split(";")[0] ?? "application/octet-stream";
  return new Blob(
    parts.map((p) => p.slice().buffer as ArrayBuffer),
    { type: safeMime },
  );
}
