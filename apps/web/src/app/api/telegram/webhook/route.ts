import { timingSafeEqual } from "node:crypto";
import { claimEvent, upsertSubscription, type PaidPlan } from "@/server/billing";
import { db } from "@/server/db";
import { env, features } from "@/server/env";
import { json } from "@/server/http";
import { botApi, decodeInvoicePayload } from "@/server/telegram";
import { audit } from "@/server/users";

export const runtime = "nodejs";

interface Update {
  update_id: number;
  message?: {
    chat: { id: number };
    from?: { id: number; language_code?: string };
    text?: string;
    successful_payment?: {
      currency: string;
      total_amount: number;
      invoice_payload: string;
      telegram_payment_charge_id: string;
      subscription_expiration_date?: number;
      is_recurring?: boolean;
      is_first_recurring?: boolean;
    };
  };
  pre_checkout_query?: { id: string; from: { id: number }; currency: string; total_amount: number; invoice_payload: string };
}

function secretOk(req: Request) {
  const expected = env().TELEGRAM_WEBHOOK_SECRET;
  const got = req.headers.get("x-telegram-bot-api-secret-token") ?? "";
  if (!expected) return false;
  const a = Buffer.from(expected),
    b = Buffer.from(got);
  return a.length === b.length && timingSafeEqual(a, b);
}

/**
 * Bot updates: /start (opens the Mini App), Stars pre-checkout validation
 * and successful (recurring) payments → subscription.
 */
export async function POST(req: Request) {
  if (!features.telegram() || !secretOk(req)) return json({ error: "forbidden" }, { status: 403 });
  const update = (await req.json()) as Update;
  try {
    if (update.pre_checkout_query) {
      const q = update.pre_checkout_query;
      const p = decodeInvoicePayload(q.invoice_payload);
      let ok = !!p && q.currency === "XTR";
      if (ok && features.backend()) {
        const { data } = await db().from("users").select("telegram_id").eq("id", p!.userId).maybeSingle();
        ok = (data as { telegram_id: number | null } | null)?.telegram_id === q.from.id;
      }
      await botApi("answerPreCheckoutQuery", ok ? { pre_checkout_query_id: q.id, ok: true } : { pre_checkout_query_id: q.id, ok: false, error_message: "This invoice isn't valid for your account." });
    }

    const pay = update.message?.successful_payment;
    if (pay && features.backend()) {
      const p = decodeInvoicePayload(pay.invoice_payload);
      if (p && pay.currency === "XTR" && (await claimEvent(`tg:${pay.telegram_payment_charge_id}`, "telegram_stars", "successful_payment", pay))) {
        const expires = pay.subscription_expiration_date ? new Date(pay.subscription_expiration_date * 1000) : new Date(Date.now() + 30 * 86_400_000);
        await upsertSubscription({
          userId: p.userId,
          plan: p.plan as PaidPlan,
          status: "active",
          provider: "telegram_stars",
          // one row per user+plan; renewals extend it
          providerSubscriptionId: `tg:${update.message!.from?.id}:${p.plan}`,
          providerCustomerId: String(update.message!.from?.id ?? ""),
          periodStart: new Date(),
          expiresAt: expires,
        });
        await audit(p.userId, "billing.stars_payment", p.plan, { amount: pay.total_amount, recurring: !!pay.is_recurring });
        await botApi("sendMessage", { chat_id: update.message!.chat.id, text: "You're Pro now. Unlimited looks, AI Stylist and HD export are unlocked. ✦" });
      }
    }

    const text = update.message?.text;
    if (text?.startsWith("/start")) {
      await botApi("sendMessage", {
        chat_id: update.message!.chat.id,
        text: "Meet your digital twin. Scan your head in 15 seconds, then try any haircut, beard or glasses on yourself — in real 3D.",
        reply_markup: { inline_keyboard: [[{ text: "Open TwinMe", web_app: { url: `${env().NEXT_PUBLIC_SITE_URL}/tg` } }]] },
      });
    }
  } catch (e) {
    console.error("[tg webhook]", e);
    // Always 200: Telegram would otherwise redeliver indefinitely; failures are logged.
  }
  return json({ ok: true });
}
