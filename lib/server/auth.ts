import { createHash, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/config";
import type { RoomMember, RoomMeta } from "@/types/room";
import { serverEnv } from "./env";
import { ApiError } from "./http";

function signingKey(): Uint8Array {
  return new TextEncoder().encode(serverEnv().SESSION_SIGNING_SECRET);
}

export function sha256B64UrlSync(input: string | Uint8Array): string {
  return createHash("sha256").update(input).digest("base64url");
}

/** Constant-time equality of two base64url-encoded digests. */
export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "base64url");
  const bufB = Buffer.from(b, "base64url");
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return timingSafeEqual(bufA, bufB);
}

export interface SessionClaims {
  rid: string;
  mid: string;
  tok: string;
  sv: number;
  purpose: "session";
}

export function sessionCookieName(roomId: string): string {
  return `wawe_s_${roomId}`;
}

export async function signSession(
  claims: Omit<SessionClaims, "purpose">,
  roomExpiresAt: Date,
): Promise<{ token: string; maxAgeSeconds: number }> {
  const now = Math.floor(Date.now() / 1000);
  const maxAgeSeconds = Math.max(
    60,
    Math.min(
      APP_CONFIG.sessionMaxAgeSeconds,
      Math.floor(roomExpiresAt.getTime() / 1000) - now,
    ),
  );
  const token = await new SignJWT({ ...claims, purpose: "session" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + maxAgeSeconds)
    .sign(signingKey());
  return { token, maxAgeSeconds };
}

export function setSessionCookie(
  res: NextResponse,
  roomId: string,
  token: string,
  maxAgeSeconds: number,
): void {
  res.cookies.set(sessionCookieName(roomId), token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: maxAgeSeconds,
  });
}

export function clearSessionCookie(res: NextResponse, roomId: string): void {
  res.cookies.set(sessionCookieName(roomId), "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
}

function readCookie(req: Request, name: string): string | null {
  const header = req.headers.get("cookie");
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

export interface AuthedMember {
  member: RoomMember;
  claims: SessionClaims;
}

/**
 * Validates the signed session cookie against the authoritative room
 * metadata: the member must still exist, the token hash must match, the
 * session version must be current and the token must not be banned. Roles are
 * always taken from metadata, never from the client.
 */
export async function authenticateMember(
  req: Request,
  meta: RoomMeta,
): Promise<AuthedMember | null> {
  const raw = readCookie(req, sessionCookieName(meta.roomId));
  if (!raw) return null;
  let claims: SessionClaims;
  try {
    const { payload } = await jwtVerify(raw, signingKey());
    claims = payload as unknown as SessionClaims;
  } catch {
    return null;
  }
  if (claims.purpose !== "session" || claims.rid !== meta.roomId) return null;
  const member = meta.members.find((m) => m.memberId === claims.mid);
  if (!member) return null;
  if (member.sessionVersion !== claims.sv) return null;
  const tokenHash = sha256B64UrlSync(claims.tok);
  if (!safeEqual(tokenHash, member.tokenHash)) return null;
  if (meta.bannedTokenHashes.some((h) => safeEqual(h, tokenHash))) return null;
  return { member, claims };
}

export async function requireMember(
  req: Request,
  meta: RoomMeta,
): Promise<AuthedMember> {
  const authed = await authenticateMember(req, meta);
  if (!authed) throw new ApiError(401, "unauthorized");
  return authed;
}

export async function requireOwner(
  req: Request,
  meta: RoomMeta,
): Promise<AuthedMember> {
  const authed = await requireMember(req, meta);
  if (authed.member.role !== "owner") {
    throw new ApiError(403, "forbidden");
  }
  return authed;
}

/** Short-lived proof that the caller knows the room password. */
interface UnlockClaims {
  rid: string;
  purpose: "join";
}

export async function signUnlockToken(roomId: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ rid: roomId, purpose: "join" } satisfies UnlockClaims)
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt(now)
    .setExpirationTime(now + APP_CONFIG.unlockTokenMaxAgeSeconds)
    .sign(signingKey());
}

export async function verifyUnlockToken(
  token: string,
  roomId: string,
): Promise<boolean> {
  try {
    const { payload } = await jwtVerify(token, signingKey());
    const claims = payload as unknown as UnlockClaims;
    return claims.purpose === "join" && claims.rid === roomId;
  } catch {
    return false;
  }
}
