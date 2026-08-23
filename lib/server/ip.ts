import { createHmac } from "node:crypto";
import { serverEnv } from "./env";

/**
 * Extracts the client IP from proxy headers. On Vercel `x-forwarded-for`
 * carries the real client IP first. The raw IP is used transiently for
 * fingerprinting and rate limiting and is never stored or logged.
 */
export function getClientIp(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) {
    const first = fwd.split(",")[0]?.trim();
    if (first) return normalizeIp(first);
  }
  const real = req.headers.get("x-real-ip");
  if (real) return normalizeIp(real.trim());
  return "unknown";
}

function normalizeIp(ip: string): string {
  let value = ip.toLowerCase();
  // Strip IPv4 port suffix ("1.2.3.4:5678") and bracketed IPv6.
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    if (end !== -1) value = value.slice(1, end);
  } else if (value.includes(".") && value.includes(":")) {
    value = value.split(":")[0] ?? value;
  }
  // Collapse IPv4-mapped IPv6.
  if (value.startsWith("::ffff:")) value = value.slice(7);
  return value;
}

/**
 * Keyed fingerprint of an IP. Only this HMAC is ever stored (for bans) —
 * never the raw address. A user on a new network or VPN will have a new
 * fingerprint; IP bans are best-effort by design.
 */
export function ipFingerprint(req: Request): string {
  const ip = getClientIp(req);
  return createHmac("sha256", serverEnv().IP_HMAC_SECRET)
    .update(ip)
    .digest("hex");
}
