/** An AES-GCM encrypted box. All fields are base64url. */
export interface EncryptedBox {
  iv: string;
  ct: string;
}

export interface KdfParams {
  algorithm: "argon2id";
  memoryKiB: number;
  iterations: number;
  parallelism: number;
}

/** One key epoch. The epoch key is random and wrapped with the password-derived KEK. */
export interface KeyEpoch {
  epoch: number;
  wrappedKey: EncryptedBox;
  createdAt: string;
}

/**
 * Everything the server stores about room crypto. None of it is secret enough
 * to decrypt anything: the KDF salt/params are public by design, the verifier
 * is a hash of a derived key, and epoch keys are wrapped with the KEK that
 * only password holders can derive.
 */
export interface RoomCryptoMeta {
  protocolVersion: number;
  /** base64url KDF salt */
  salt: string;
  kdf: KdfParams;
  /** base64url SHA-256 of the client-derived auth key */
  verifierHash: string;
  currentEpoch: number;
  epochs: KeyEpoch[];
  /** Incremented on every password change / key rotation. */
  cryptoVersion: number;
}
