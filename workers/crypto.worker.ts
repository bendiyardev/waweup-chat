/**
 * Dedicated crypto worker. Heavy operations (Argon2id key stretching and
 * attachment chunk encryption/decryption) run here so the UI thread never
 * blocks — critical on low-end mobile devices.
 */
import { deriveMasterKey } from "@/lib/crypto/argon";
import { aesGcmDecryptChunk, aesGcmEncryptChunk } from "@/lib/crypto/aes";
import { fromB64Url } from "@/lib/crypto/encoding";
import { deriveFileKey } from "@/lib/crypto/keys";
import { chunkAad } from "@/lib/crypto/protocol";
import type { KdfParams } from "@/types/crypto";

export type CryptoWorkerRequest =
  | {
      id: number;
      op: "deriveMasterKey";
      password: string;
      saltB64: string;
      params: KdfParams;
    }
  | {
      id: number;
      op: "encryptChunk";
      epochKey: Uint8Array;
      roomId: string;
      attachmentId: string;
      chunkIndex: number;
      data: Uint8Array;
    }
  | {
      id: number;
      op: "decryptChunk";
      epochKey: Uint8Array;
      roomId: string;
      attachmentId: string;
      chunkIndex: number;
      data: Uint8Array;
    };

export type CryptoWorkerResponse =
  | { id: number; ok: true; data: Uint8Array }
  | { id: number; ok: false; error: string };

async function handle(req: CryptoWorkerRequest): Promise<Uint8Array> {
  switch (req.op) {
    case "deriveMasterKey": {
      return deriveMasterKey(req.password, fromB64Url(req.saltB64), req.params);
    }
    case "encryptChunk": {
      const key = await deriveFileKey(req.epochKey, req.attachmentId);
      return aesGcmEncryptChunk(
        key,
        req.data,
        chunkAad(req.roomId, req.attachmentId, req.chunkIndex),
      );
    }
    case "decryptChunk": {
      const key = await deriveFileKey(req.epochKey, req.attachmentId);
      return aesGcmDecryptChunk(
        key,
        req.data,
        chunkAad(req.roomId, req.attachmentId, req.chunkIndex),
      );
    }
  }
}

self.onmessage = (event: MessageEvent<CryptoWorkerRequest>) => {
  const req = event.data;
  handle(req)
    .then((data) => {
      const response: CryptoWorkerResponse = { id: req.id, ok: true, data };
      // Transfer the buffer instead of copying it.
      (self as unknown as Worker).postMessage(response, [
        data.buffer as ArrayBuffer,
      ]);
    })
    .catch((error: unknown) => {
      const response: CryptoWorkerResponse = {
        id: req.id,
        ok: false,
        error: error instanceof Error ? error.message : "Crypto error",
      };
      (self as unknown as Worker).postMessage(response);
    });
};
