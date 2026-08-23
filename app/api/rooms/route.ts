import { NextResponse } from "next/server";
import { APP_CONFIG } from "@/lib/config";
import type { ExpirationPreset } from "@/lib/config";
import { fromB64Url } from "@/lib/crypto/encoding";
import { generateMemberId, generateMemberToken } from "@/lib/crypto/ids";
import {
  setSessionCookie,
  sha256B64UrlSync,
  signSession,
} from "@/lib/server/auth";
import {
  handleApiError,
  jsonError,
  readJsonBody,
  requireSameOrigin,
} from "@/lib/server/http";
import { ipFingerprint } from "@/lib/server/ip";
import { logOp } from "@/lib/server/log";
import { rateLimit } from "@/lib/server/ratelimit";
import { computeExpiresAt, persistNewRoom } from "@/lib/server/rooms";
import { createRoomSchema } from "@/lib/validation/schemas";
import type { RoomMeta } from "@/types/room";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Idempotency: a double-submitted create returns the first room. */
const recentCreates = new Map<
  string,
  { body: { roomId: string; expiresAt: string }; token: string; maxAge: number }
>();

function rememberCreate(
  key: string,
  value: {
    body: { roomId: string; expiresAt: string };
    token: string;
    maxAge: number;
  },
) {
  recentCreates.set(key, value);
  setTimeout(() => recentCreates.delete(key), 10 * 60 * 1000).unref?.();
}

export async function POST(req: Request) {
  const start = Date.now();
  try {
    requireSameOrigin(req);
    const limited = rateLimit(`create:${ipFingerprint(req)}`, 10, 60 * 60_000);
    if (!limited.ok) {
      return jsonError(429, "rate_limited", "Too many rooms created");
    }

    const idempotencyKey = req.headers.get("x-idempotency-key");
    if (idempotencyKey && idempotencyKey.length <= 128) {
      const prior = recentCreates.get(idempotencyKey);
      if (prior) {
        const res = NextResponse.json(prior.body, {
          status: 201,
          headers: { "Cache-Control": "no-store" },
        });
        setSessionCookie(res, prior.body.roomId, prior.token, prior.maxAge);
        return res;
      }
    }

    const body = await readJsonBody(req, createRoomSchema);

    const now = new Date();
    const expiresAt = computeExpiresAt(
      body.expiresPreset as ExpirationPreset,
      now,
    );
    const memberId = generateMemberId();
    const memberToken = generateMemberToken();

    const meta: RoomMeta = {
      schemaVersion: 1,
      // The ID is generated client-side (192 random bits) because the
      // encrypted material binds it; the create-only write below turns any
      // collision into a 409 and the client retries with a fresh ID.
      roomId: body.roomId,
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      encryptedRoomName: body.encryptedRoomName,
      roomNameEpoch: 1,
      crypto: {
        protocolVersion: APP_CONFIG.cryptoProtocolVersion,
        salt: body.salt,
        kdf: body.kdf,
        // The server never sees the password: it stores only the hash of a
        // derived auth key.
        verifierHash: sha256B64UrlSync(fromB64Url(body.authKey)),
        currentEpoch: 1,
        epochs: [
          {
            epoch: 1,
            wrappedKey: body.wrappedEpochKey,
            createdAt: now.toISOString(),
          },
        ],
        cryptoVersion: 1,
      },
      members: [
        {
          memberId,
          role: "owner",
          tokenHash: sha256B64UrlSync(memberToken),
          encryptedDisplayName: null,
          displayNameEpoch: null,
          joinedAt: now.toISOString(),
          sessionVersion: 1,
          ipHmac: ipFingerprint(req),
        },
      ],
      locked: false,
      bannedTokenHashes: [],
      bannedIpHmacs: [],
      ownerRecoveryHash: body.recoveryKeyHash,
      version: 1,
    };

    await persistNewRoom(meta);

    const session = await signSession(
      { rid: meta.roomId, mid: memberId, tok: memberToken, sv: 1 },
      expiresAt,
    );
    const responseBody = { roomId: meta.roomId, expiresAt: meta.expiresAt };
    if (idempotencyKey && idempotencyKey.length <= 128) {
      rememberCreate(idempotencyKey, {
        body: responseBody,
        token: session.token,
        maxAge: session.maxAgeSeconds,
      });
    }

    const res = NextResponse.json(responseBody, {
      status: 201,
      headers: { "Cache-Control": "no-store" },
    });
    setSessionCookie(res, meta.roomId, session.token, session.maxAgeSeconds);
    logOp({
      op: "room.create",
      roomId: meta.roomId,
      status: 201,
      durationMs: Date.now() - start,
    });
    return res;
  } catch (error) {
    return handleApiError(error, "room.create");
  }
}
