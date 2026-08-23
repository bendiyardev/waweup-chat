import { toArrayBuffer, utf8Encode } from "./encoding";

const HKDF_SALT = utf8Encode("waweup/v1");

/** HKDF-SHA-256 with a fixed application salt and explicit domain separation. */
export async function hkdfDerive(
  ikm: Uint8Array,
  info: string,
  lengthBytes = 32,
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(ikm),
    "HKDF",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: toArrayBuffer(HKDF_SALT),
      info: toArrayBuffer(utf8Encode(info)),
    },
    baseKey,
    lengthBytes * 8,
  );
  return new Uint8Array(bits);
}
