import { type NextRequest, NextResponse } from "next/server";

/**
 * Per-request nonce CSP + hardening headers.
 * - scripts: nonce + 'strict-dynamic' (Next chunks, MediaPipe loader, Telegram SDK)
 * - 'wasm-unsafe-eval': MediaPipe WASM; no 'unsafe-eval' in production
 * - framing: only Telegram may frame /tg (Telegram Web runs Mini Apps in an iframe)
 */
export function middleware(req: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const dev = process.env.NODE_ENV !== "production";
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const isTelegram = req.nextUrl.pathname.startsWith("/tg");

  const csp = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval' https://telegram.org${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' blob: data: https://t.me https://*.telegram.org ${supabase}`,
    `font-src 'self' data:`,
    `media-src 'self' blob:`,
    `connect-src 'self' blob: data: ${supabase}${dev ? " ws: http://localhost:*" : ""}`,
    `worker-src 'self' blob:`,
    `frame-src 'self' https://oauth.telegram.org`,
    `frame-ancestors ${isTelegram ? "https://web.telegram.org https://*.telegram.org" : "'none'"}`,
    `form-action 'self'`,
    `base-uri 'none'`,
    `object-src 'none'`,
    dev ? "" : "upgrade-insecure-requests",
  ]
    .filter(Boolean)
    .join("; ");

  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const res = NextResponse.next({ request: { headers: requestHeaders } });
  res.headers.set("content-security-policy", csp);
  res.headers.set("x-content-type-options", "nosniff");
  res.headers.set("referrer-policy", "strict-origin-when-cross-origin");
  res.headers.set("permissions-policy", "camera=(self), microphone=(), geolocation=(), payment=(self), interest-cohort=()");
  res.headers.set("cross-origin-opener-policy", "same-origin-allow-popups");
  if (!isTelegram) res.headers.set("x-frame-options", "DENY");
  if (!dev) res.headers.set("strict-transport-security", "max-age=63072000; includeSubDomains; preload");
  return res;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico|mediapipe|models|robots.txt|sitemap.xml).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
