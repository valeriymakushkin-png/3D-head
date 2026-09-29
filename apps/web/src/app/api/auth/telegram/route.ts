import { z } from "zod";
import { features } from "@/server/env";
import { HttpError, body, clientIp, json, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getSession, setSessionCookie, signSession } from "@/server/session";
import { verifyInitData } from "@/server/telegram";
import { audit, upsertTelegramUser } from "@/server/users";

export const runtime = "nodejs";

/**
 * Telegram Mini App sign-in: validates `initData` (HMAC with the bot token),
 * upserts the user, merges any anonymous session, and returns a session token
 * (also set as a cookie; the Mini App keeps the token in memory because
 * Telegram Web embeds Mini Apps in a third-party iframe).
 */
export const POST = route(async (req: Request) => {
  if (!features.telegram()) throw new HttpError(503, "telegram_unavailable");
  await rateLimit(`auth-tg:${clientIp(req)}`, 30, 60);
  const { initData } = await body(req, z.object({ initData: z.string().min(10).max(8192) }), 10_000);
  const verified = verifyInitData(initData);
  if (!verified) throw new HttpError(401, "invalid_init_data");
  if (!features.backend()) {
    const token = await signSession({ userId: `tg-${verified.user.id}`, anonymous: false, telegramId: verified.user.id });
    await setSessionCookie(token);
    return json({ token, user: { id: null, name: verified.user.first_name }, startParam: verified.startParam });
  }
  const user = await upsertTelegramUser(verified.user, await getSession());
  const token = await signSession({ userId: user.id, anonymous: false, telegramId: verified.user.id });
  await setSessionCookie(token);
  await audit(user.id, "auth.telegram_miniapp", undefined, undefined, clientIp(req));
  return json({ token, user: { id: user.id, name: user.display_name, plan: user.plan }, startParam: verified.startParam });
});
