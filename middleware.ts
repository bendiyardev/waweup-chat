import { NextRequest, NextResponse } from "next/server";

/**
 * Per-request nonce-based Content-Security-Policy. Next.js picks the nonce up
 * from the request header and applies it to its own inline scripts, so no
 * 'unsafe-inline' script source is ever needed.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(
    String.fromCharCode(...crypto.getRandomValues(new Uint8Array(16))),
  );

  // next dev relies on eval for source maps / fast refresh; production
  // stays strict nonce-only.
  const isDev = process.env.NODE_ENV !== "production";
  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Inline style attributes are required by React; scripts stay nonce-only.
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `media-src 'self' blob:`,
    `font-src 'self'`,
    // Pusher websockets + direct encrypted chunk uploads to Vercel Blob.
    `connect-src 'self' wss://*.pusher.com https://*.pusher.com wss://*.pusherapp.com https://*.vercel-storage.com`,
    `worker-src 'self' blob:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
    `upgrade-insecure-requests`,
  ].join("; ");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);

  const response = NextResponse.next({
    request: { headers: requestHeaders },
  });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    // All pages, skipping static assets and API routes (APIs return JSON and
    // set their own cache/robots headers via next.config).
    {
      source:
        "/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
