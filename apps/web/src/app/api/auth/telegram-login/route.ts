import { NextResponse } from "next/server";
import { env, features } from "@/server/env";
import { clientIp, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getSession, setSessionCookie, signSession } from "@/server/session";
import { verifyLoginWidget } from "@/server/telegram";
import { audit, upsertTelegramUser } from "@/server/users";

export const runtime = "nodejs";

/**
 * Telegram Login Widget redirect target (data-auth-url). Verifies the signed
 * query, signs in, and redirects to a same-origin `next` path only.
 */
export const GET = route(async (req: Request) => {
  const url = new URL(req.url);
  const next = sanitizeNext(url.searchParams.get("next"));
  const fail = NextResponse.redirect(new URL(`/login?error=telegram&next=${encodeURIComponent(next)}`, env().NEXT_PUBLIC_SITE_URL));
  if (!features.telegram() || !features.backend()) return fail;
  await rateLimit(`auth-tgw:${clientIp(req)}`, 30, 60);
  const data = Object.fromEntries(url.searchParams.entries());
  delete data.next;
  const tg = verifyLoginWidget(data);
  if (!tg) return fail;
  const user = await upsertTelegramUser(tg, await getSession());
  await setSessionCookie(await signSession({ userId: user.id, anonymous: false, telegramId: tg.id }));
  await audit(user.id, "auth.telegram_widget", undefined, undefined, clientIp(req));
  return NextResponse.redirect(new URL(next, env().NEXT_PUBLIC_SITE_URL));
});

function sanitizeNext(n: string | null): string {
  if (!n || !n.startsWith("/") || n.startsWith("//") || n.includes("\\")) return "/studio";
  return n;
}
