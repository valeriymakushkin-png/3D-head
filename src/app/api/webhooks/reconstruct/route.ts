import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { env, features } from "@/server/env";
import { json } from "@/server/http";
import { botApi } from "@/server/telegram";

export const runtime = "nodejs";

const Payload = z.object({
  avatarId: z.string().uuid(),
  status: z.enum(["ready", "failed"]),
  error: z.string().max(500).optional(),
});

/**
 * GPU worker → web notification (the worker writes results to Postgres and
 * Storage itself; this endpoint only fans out user notifications).
 * Signature: `x-twinme-signature: t=<unix>,v1=<hex hmac_sha256(secret, t + "." + body)>`.
 */
export async function POST(req: Request) {
  const secret = env().RECON_WEBHOOK_SECRET;
  if (!secret || !features.backend()) return json({ error: "unavailable" }, { status: 503 });
  const raw = await req.text();
  const header = req.headers.get("x-twinme-signature") ?? "";
  const parts = Object.fromEntries(header.split(",").map((p) => p.split("=") as [string, string]));
  const t = Number(parts.t);
  if (!parts.v1 || !Number.isFinite(t) || Math.abs(Date.now() / 1000 - t) > 300) return json({ error: "bad_signature" }, { status: 401 });
  const expected = createHmac("sha256", secret).update(`${t}.${raw}`).digest();
  const got = Buffer.from(parts.v1, "hex");
  if (got.length !== expected.length || !timingSafeEqual(got, expected)) return json({ error: "bad_signature" }, { status: 401 });

  const p = Payload.safeParse(JSON.parse(raw));
  if (!p.success) return json({ error: "bad_request" }, { status: 400 });
  const { data } = await db().from("avatars").select("user_id, users(telegram_id)").eq("id", p.data.avatarId).maybeSingle();
  const tgId = (data as { users?: { telegram_id: number | null } | null } | null)?.users?.telegram_id;
  if (tgId && features.telegram()) {
    const ready = p.data.status === "ready";
    await botApi("sendMessage", {
      chat_id: tgId,
      text: ready ? "Your HD twin is ready — sharper skin, real hair volume, every angle." : "We couldn't finish your HD twin. Try a new scan in brighter, even light.",
      reply_markup: { inline_keyboard: [[{ text: ready ? "Open my HD twin" : "Scan again", web_app: { url: `${env().NEXT_PUBLIC_SITE_URL}/tg${ready ? `?avatar=${p.data.avatarId}` : "?create=1"}` } }]] },
    }).catch((e) => console.warn("[recon webhook] notify failed", e));
  }
  return json({ ok: true });
}
