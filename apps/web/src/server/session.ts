import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { cookies, headers } from "next/headers";
import { env, features } from "@/server/env";
import { db, must } from "@/server/db";

/**
 * Stateless sessions: an HS256 JWT in an httpOnly cookie, also accepted as a
 * Bearer token (Telegram Web runs Mini Apps in a third-party iframe where
 * cookies are unreliable, so the Mini App keeps the token in memory).
 */
export const SESSION_COOKIE = "tm_session";
const MAX_AGE = 60 * 60 * 24 * 30;

export interface Session {
  userId: string;
  anonymous: boolean;
  telegramId: number | null;
}

let devSecret: Uint8Array | null = null;
function secret(): Uint8Array {
  const s = env().SESSION_SECRET;
  if (s) return new TextEncoder().encode(s);
  // Dev only (env() refuses to boot production without SESSION_SECRET).
  devSecret ??= crypto.getRandomValues(new Uint8Array(32));
  return devSecret;
}

export async function signSession(s: Session): Promise<string> {
  return new SignJWT({ anon: s.anonymous, tg: s.telegramId })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(s.userId)
    .setIssuedAt()
    .setIssuer("twinme")
    .setAudience("twinme-web")
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<Session | null> {
  try {
    const { payload } = await jwtVerify(token, secret(), { issuer: "twinme", audience: "twinme-web", algorithms: ["HS256"] });
    if (typeof payload.sub !== "string") return null;
    return { userId: payload.sub, anonymous: payload.anon === true, telegramId: typeof payload.tg === "number" ? payload.tg : null };
  } catch {
    return null;
  }
}

export async function getSession(): Promise<Session | null> {
  const auth = (await headers()).get("authorization");
  if (auth?.startsWith("Bearer ")) return verifySession(auth.slice(7));
  const c = (await cookies()).get(SESSION_COOKIE)?.value;
  return c ? verifySession(c) : null;
}

export async function setSessionCookie(token: string) {
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: env().NODE_ENV === "production",
    // "none" + partitioned keeps the session inside Telegram Web's iframe.
    sameSite: env().NODE_ENV === "production" ? "none" : "lax",
    partitioned: env().NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE,
  });
}

export async function clearSession() {
  (await cookies()).delete(SESSION_COOKIE);
}

/**
 * Returns the current session, creating an anonymous user on first metered
 * use so the free tier is enforced server-side before sign-up.
 */
export async function ensureSession(): Promise<Session> {
  const existing = await getSession();
  if (existing) return existing;
  let userId: string;
  if (features.backend()) {
    const row = must(await db().from("users").insert({ is_anonymous: true }).select("id").single());
    userId = (row as unknown as { id: string }).id;
  } else {
    userId = crypto.randomUUID();
  }
  const s: Session = { userId, anonymous: true, telegramId: null };
  await setSessionCookie(await signSession(s));
  return s;
}
