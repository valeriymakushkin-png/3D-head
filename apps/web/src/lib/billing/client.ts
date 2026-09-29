"use client";

import { apiFetch } from "@/lib/api/fetch";
import type { Plan } from "@/lib/account";
import { getTelegram } from "@/lib/telegram/webapp";

/**
 * Starts a purchase. Inside Telegram, digital goods must be sold for Stars
 * (Telegram policy), so we request a Stars subscription invoice link and
 * open it natively; on the web we redirect to Stripe Checkout.
 */
export async function openCheckout(plan: Exclude<Plan, "free">): Promise<{ ok: true } | { ok: false; message: string }> {
  const tg = getTelegram();
  try {
    if (tg?.initData) {
      const res = await apiFetch("/api/billing/telegram-invoice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      if (!res.ok) return { ok: false, message: await res.text() };
      const { url } = (await res.json()) as { url: string };
      return await new Promise((resolve) =>
        tg.openInvoice(url, (status) => {
          if (status === "paid") resolve({ ok: true });
          else resolve({ ok: false, message: status === "cancelled" ? "Payment cancelled" : `Payment ${status}` });
        }),
      );
    }
    const res = await apiFetch("/api/billing/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan, returnTo: window.location.pathname }),
    });
    if (res.status === 401) {
      window.location.href = `/login?next=${encodeURIComponent(window.location.pathname)}`;
      return { ok: true };
    }
    if (!res.ok) return { ok: false, message: (await res.text()) || "Checkout unavailable" };
    const { url } = (await res.json()) as { url: string };
    window.location.href = url;
    return { ok: true };
  } catch (e) {
    return { ok: false, message: String(e) };
  }
}
