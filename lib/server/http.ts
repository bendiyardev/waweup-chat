import { NextResponse } from "next/server";
import { ZodType } from "zod";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message?: string,
  ) {
    super(message ?? code);
  }
}

export function jsonError(
  status: number,
  code: string,
  message?: string,
): NextResponse {
  return NextResponse.json(
    { error: { code, message: message ?? code } },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

export function jsonOk<T>(data: T, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, {
    ...init,
    headers: { "Cache-Control": "no-store", ...(init?.headers ?? {}) },
  });
}

export function handleApiError(error: unknown, op: string): NextResponse {
  if (error instanceof ApiError) {
    return jsonError(error.status, error.code, error.message);
  }
  // Never leak internals; log only the category.
  console.error(
    JSON.stringify({ op, status: "error", errorCategory: categorize(error) }),
  );
  return jsonError(500, "internal_error", "Something went wrong");
}

function categorize(error: unknown): string {
  if (error instanceof Error) return error.name;
  return "unknown";
}

/**
 * CSRF guard for cookie-authenticated mutations: the request must come from
 * our own origin. Sec-Fetch-Site is checked when present; Origin must match
 * the Host when provided.
 */
export function requireSameOrigin(req: Request): void {
  const secFetchSite = req.headers.get("sec-fetch-site");
  if (secFetchSite && !["same-origin", "none"].includes(secFetchSite)) {
    throw new ApiError(403, "cross_origin_rejected");
  }
  const origin = req.headers.get("origin");
  if (origin) {
    const host = req.headers.get("host");
    try {
      if (new URL(origin).host !== host) {
        throw new ApiError(403, "cross_origin_rejected");
      }
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(403, "cross_origin_rejected");
    }
  }
}

const DEFAULT_MAX_BODY_BYTES = 128 * 1024;

/** Reads and validates a JSON body with a hard size cap. */
export async function readJsonBody<T>(
  req: Request,
  schema: ZodType<T>,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<T> {
  const lengthHeader = req.headers.get("content-length");
  if (lengthHeader && Number(lengthHeader) > maxBytes) {
    throw new ApiError(413, "payload_too_large");
  }
  let raw: string;
  try {
    raw = await req.text();
  } catch {
    throw new ApiError(400, "invalid_body");
  }
  if (raw.length > maxBytes) {
    throw new ApiError(413, "payload_too_large");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ApiError(400, "invalid_json");
  }
  const result = schema.safeParse(parsed);
  if (!result.success) {
    throw new ApiError(400, "invalid_request");
  }
  return result.data;
}
