/**
 * Minimal structured logging. Deliberately never logs message content,
 * passwords, keys, tokens, raw IPs or any other sensitive material —
 * only operation names, opaque IDs, status and timing.
 */
export function logOp(entry: {
  op: string;
  roomId?: string;
  status: number | "ok" | "error";
  durationMs?: number;
  errorCategory?: string;
}): void {
  console.log(
    JSON.stringify({
      t: new Date().toISOString(),
      ...entry,
    }),
  );
}
