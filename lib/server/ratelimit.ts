/**
 * Ephemeral, per-instance rate limiting. This is honest best-effort
 * protection: serverless instances do not share memory, so these limits are
 * not globally exact. They still stop naive brute force from a single edge
 * instance, and they compose with Vercel's platform-level firewall limits.
 * The real defense against password brute force is Argon2id + a strong
 * password, both enforced elsewhere.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();

function sweep(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

export function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): { ok: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  sweep(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSeconds: 0 };
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((bucket.resetAt - now) / 1000),
    };
  }
  return { ok: true, retryAfterSeconds: 0 };
}

/** Escalating cooldown for failed unlock attempts (per room + IP HMAC). */
const failures = new Map<string, { count: number; blockedUntil: number }>();

export function registerUnlockFailure(key: string): void {
  const entry = failures.get(key) ?? { count: 0, blockedUntil: 0 };
  entry.count += 1;
  if (entry.count >= 5) {
    // 2^(n-5) seconds after the 5th failure, capped at 5 minutes.
    const delaySeconds = Math.min(2 ** (entry.count - 5 + 1), 300);
    entry.blockedUntil = Date.now() + delaySeconds * 1000;
  }
  failures.set(key, entry);
}

export function clearUnlockFailures(key: string): void {
  failures.delete(key);
}

export function unlockCooldownSeconds(key: string): number {
  const entry = failures.get(key);
  if (!entry) return 0;
  const remaining = entry.blockedUntil - Date.now();
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

/** Test-only helper. */
export function resetRateLimiter(): void {
  buckets.clear();
  failures.clear();
}
