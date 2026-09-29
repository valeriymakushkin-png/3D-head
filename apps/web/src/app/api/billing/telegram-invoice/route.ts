import { z } from "zod";
import { env, features } from "@/server/env";
import { HttpError, body, json, route } from "@/server/http";
import { rateLimit } from "@/server/ratelimit";
import { getSession } from "@/server/session";
import { botApi, encodeInvoicePayload } from "@/server/telegram";

export const runtime = "nodejs";

const TITLES = { pro: "TwinMe Pro", barber: "TwinMe Barber", clinic: "TwinMe Clinic" } as const;

/**
 * Telegram Stars subscription invoice (digital goods in Mini Apps must be
 * sold in Stars). Returns an invoice link opened with WebApp.openInvoice.
 */
export const POST = route(async (req: Request) => {
  if (!features.telegram() || !features.backend()) throw new HttpError(503, "billing_unavailable");
  const session = await getSession();
  if (!session?.telegramId) throw new HttpError(401, "unauthorized", "Open TwinMe inside Telegram to pay with Stars");
  await rateLimit(`tg-invoice:${session.userId}`, 10, 300);
  const { plan } = await body(req, z.object({ plan: z.enum(["pro", "barber", "clinic"]) }));
  const amount = { pro: env().TELEGRAM_STARS_PRO, barber: env().TELEGRAM_STARS_BARBER, clinic: env().TELEGRAM_STARS_CLINIC }[plan];
  const url = await botApi<string>("createInvoiceLink", {
    title: TITLES[plan],
    description: "Unlimited AI transformations, AI Stylist and HD export for your 3D twin. Renews monthly.",
    payload: encodeInvoicePayload(session.userId, plan),
    currency: "XTR",
    prices: [{ label: TITLES[plan], amount }],
    subscription_period: 2_592_000, // 30 days — the only period Telegram supports
  });
  return json({ url });
});
