"use client";

import type {
  CryptoWorkerRequest,
  CryptoWorkerResponse,
} from "@/workers/crypto.worker";
import type { KdfParams } from "@/types/crypto";

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<
  number,
  { resolve: (data: Uint8Array) => void; reject: (err: Error) => void }
>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL("../../workers/crypto.worker.ts", import.meta.url));
    worker.onmessage = (event: MessageEvent<CryptoWorkerResponse>) => {
      const res = event.data;
      const entry = pending.get(res.id);
      if (!entry) return;
      pending.delete(res.id);
      if (res.ok) entry.resolve(res.data);
      else entry.reject(new Error(res.error));
    };
    worker.onerror = () => {
      for (const [, entry] of pending) {
        entry.reject(new Error("Crypto worker failed"));
      }
      pending.clear();
    };
  }
  return worker;
}

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown
  ? Omit<T, K>
  : never;

function call(
  req: DistributiveOmit<CryptoWorkerRequest, "id">,
  transfer?: Transferable[],
): Promise<Uint8Array> {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    getWorker().postMessage({ ...req, id }, transfer ?? []);
  });
}

/** Argon2id in the worker — never blocks the UI thread. */
export function workerDeriveMasterKey(
  password: string,
  saltB64: string,
  params: KdfParams,
): Promise<Uint8Array> {
  return call({ op: "deriveMasterKey", password, saltB64, params });
}

export function workerEncryptChunk(
  epochKeyRaw: Uint8Array,
  roomId: string,
  attachmentId: string,
  chunkIndex: number,
  data: Uint8Array,
): Promise<Uint8Array> {
  // Copy the epoch key (it is reused); transfer the chunk buffer.
  return call(
    {
      op: "encryptChunk",
      epochKey: new Uint8Array(epochKeyRaw),
      roomId,
      attachmentId,
      chunkIndex,
      data,
    },
    [data.buffer as ArrayBuffer],
  );
}

export function workerDecryptChunk(
  epochKeyRaw: Uint8Array,
  roomId: string,
  attachmentId: string,
  chunkIndex: number,
  data: Uint8Array,
): Promise<Uint8Array> {
  return call(
    {
      op: "decryptChunk",
      epochKey: new Uint8Array(epochKeyRaw),
      roomId,
      attachmentId,
      chunkIndex,
      data,
    },
    [data.buffer as ArrayBuffer],
  );
}
