"use client";

/**
 * Same-origin fetch that also sends the session as a Bearer token when one
 * was issued in-memory (Telegram Web embeds Mini Apps in a third-party
 * iframe where cookies may be blocked).
 */
let bearer: string | null = null;

export function setBearer(token: string | null) {
  bearer = token;
}

export function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (bearer && !headers.has("authorization")) headers.set("authorization", `Bearer ${bearer}`);
  return fetch(input, { ...init, headers, credentials: "same-origin" });
}
