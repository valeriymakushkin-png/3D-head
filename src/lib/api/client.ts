"use client";

import { apiFetch } from "@/lib/api/fetch";
import type { LookPatch } from "@/lib/avatar/look";
import { type StylistEvent, type StylistRequest, readEvents } from "@/lib/ai/protocol";

export type MeterResult = { ok: true; remaining: number | null } | { ok: false; code: "quota_exceeded" | "error"; message: string };

/**
 * Records a metered transformation (Glow Up, AI-applied look, saved look).
 * The server is the source of truth for quotas; anonymous visitors get a
 * device session cookie so the free tier is enforced before sign-up too.
 */
export async function meterTransformation(body: {
  type: "glow_up" | "stylist" | "look";
  avatarId: string | null;
  settings: unknown;
}): Promise<MeterResult> {
  try {
    const res = await apiFetch("/api/transformations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.status === 402) return { ok: false, code: "quota_exceeded", message: "Free transformations used" };
    if (!res.ok) return { ok: false, code: "error", message: await res.text() };
    const j = (await res.json()) as { remaining: number | null };
    return { ok: true, remaining: j.remaining };
  } catch (e) {
    return { ok: false, code: "error", message: String(e) };
  }
}

export async function* streamStylist(req: StylistRequest, signal?: AbortSignal): AsyncGenerator<StylistEvent> {
  const res = await apiFetch("/api/stylist", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "text/event-stream" },
    body: JSON.stringify(req),
    signal,
  });
  if (res.status === 402) {
    yield { type: "error", code: "quota_exceeded", message: "AI Stylist is part of Pro." };
    return;
  }
  if (res.status === 429) {
    yield { type: "error", code: "rate_limited", message: "Easy there — try again in a moment." };
    return;
  }
  if (!res.ok || !res.body) {
    yield { type: "error", code: "unavailable", message: "The stylist is unavailable right now." };
    return;
  }
  yield* readEvents(res.body);
}

export async function fetchGlowUpNarrative(body: { analysis: unknown; before: unknown; after: unknown; patch: LookPatch }, signal?: AbortSignal) {
  const res = await apiFetch("/api/glow-up", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal });
  if (!res.ok || res.status === 204) return null;
  return (await res.json()) as { headline: string; rationale: string[] };
}
