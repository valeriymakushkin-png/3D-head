import "server-only";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { env } from "@/server/env";

export const TelegramUserSchema = z.object({
  id: z.number().int().positive(),
  first_name: z.string().max(256).default(""),
  last_name: z.string().max(256).optional(),
  username: z.string().max(64).optional(),
  language_code: z.string().max(16).optional(),
  photo_url: z.string().url().optional(),
  is_premium: z.boolean().optional(),
});
export type TelegramUser = z.infer<typeof TelegramUserSchema>;

function safeEqualHex(a: string, b: string) {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

/**
 * Validates Mini App `initData` (HMAC-SHA256 with key HMAC("WebAppData", bot
 * token)). Rejects stale payloads to limit replay.
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData: string, maxAgeSeconds = 86_400): { user: TelegramUser; startParam: string | null } | null {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token || initData.length > 8192) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return null;
  const secretKey = createHmac("sha256", "WebAppData").update(token).digest();

  const check = (exclude: string[]) => {
    const pairs: string[] = [];
    params.forEach((v, k) => {
      if (!exclude.includes(k)) pairs.push(`${k}=${v}`);
    });
    pairs.sort();
    return createHmac("sha256", secretKey).update(pairs.join("\n")).digest("hex");
  };
  // Bot API 8+ adds `signature` (for third-party Ed25519 checks); accept the
  // HMAC computed either with or without it — both are keyed by our token.
  const ok = safeEqualHex(check(["hash"]), hash) || (params.has("signature") && safeEqualHex(check(["hash", "signature"]), hash));
  if (!ok) return null;

  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || Date.now() / 1000 - authDate > maxAgeSeconds) return null;
  const rawUser = params.get("user");
  if (!rawUser) return null;
  const user = TelegramUserSchema.safeParse(JSON.parse(rawUser));
  if (!user.success) return null;
  return { user: user.data, startParam: params.get("start_param") };
}

/**
 * Validates Telegram Login Widget data (key = SHA256(bot token)).
 * https://core.telegram.org/widgets/login#checking-authorization
 */
export function verifyLoginWidget(data: Record<string, string>, maxAgeSeconds = 86_400): TelegramUser | null {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token || !data.hash) return null;
  const allowed = ["id", "first_name", "last_name", "username", "photo_url", "auth_date"];
  const dcs = Object.keys(data)
    .filter((k) => allowed.includes(k))
    .sort()
    .map((k) => `${k}=${data[k]}`)
    .join("\n");
  const secretKey = createHash("sha256").update(token).digest();
  const expected = createHmac("sha256", secretKey).update(dcs).digest("hex");
  if (!safeEqualHex(expected, data.hash)) return null;
  if (Date.now() / 1000 - Number(data.auth_date) > maxAgeSeconds) return null;
  const parsed = TelegramUserSchema.safeParse({
    id: Number(data.id),
    first_name: data.first_name,
    last_name: data.last_name,
    username: data.username,
    photo_url: data.photo_url,
  });
  return parsed.success ? parsed.data : null;
}

/** Minimal typed Bot API client. */
export async function botApi<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN not configured");
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  const json = (await res.json()) as { ok: boolean; result?: T; description?: string };
  if (!json.ok) throw new Error(`Telegram ${method}: ${json.description ?? res.status}`);
  return json.result as T;
}

/** Invoice payloads are ≤128 bytes: compact, versioned, and verified on use. */
export function encodeInvoicePayload(userId: string, plan: string) {
  return `v1:${plan}:${userId}`;
}
export function decodeInvoicePayload(p: string): { plan: string; userId: string } | null {
  const m = /^v1:(pro|barber|clinic):([0-9a-f-]{36})$/.exec(p);
  return m ? { plan: m[1], userId: m[2] } : null;
}
