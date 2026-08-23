import { argon2id } from "hash-wasm";
import type { KdfParams } from "@/types/crypto";

/**
 * Argon2id password stretching. This is CPU/memory heavy by design — in the
 * browser it must only ever run inside the crypto Web Worker (see
 * workers/crypto.worker.ts) so the UI thread never blocks.
 */
export async function deriveMasterKey(
  password: string,
  salt: Uint8Array,
  params: KdfParams,
): Promise<Uint8Array> {
  if (params.algorithm !== "argon2id") {
    throw new Error(`Unsupported KDF: ${params.algorithm}`);
  }
  return argon2id({
    password,
    salt,
    parallelism: params.parallelism,
    iterations: params.iterations,
    memorySize: params.memoryKiB,
    hashLength: 32,
    outputType: "binary",
  });
}
