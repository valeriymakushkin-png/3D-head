"use client";

import { apiFetch } from "@/lib/api/fetch";
import type { CaptureFrame } from "@/lib/recon/types";

/**
 * Starts an HD Twin in the cloud (Pro): uploads the captured frames straight
 * to private storage via one-time signed URLs, then enqueues the GPU job.
 * Runs after the Instant Twin is ready, so the user is never blocked on it.
 */
export async function startHdTwin(frames: CaptureFrame[], analysis: unknown): Promise<{ ok: true; avatarId: string } | { ok: false; reason: string }> {
  const picked = [...frames].sort((a, b) => b.quality.score - a.quality.score).slice(0, 15);
  const res = await apiFetch("/api/avatars", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      source: picked[0]?.source === "guided" ? "guided" : "photos",
      captures: picked.map((f) => ({ kind: "photo", contentType: "image/jpeg", pose: f.pose })),
      analysis,
    }),
  });
  if (!res.ok) return { ok: false, reason: res.status === 402 ? "pro_required" : `http_${res.status}` };
  const { avatarId, uploads } = (await res.json()) as { avatarId: string; uploads: Array<{ index: number; url: string; contentType: string }> };
  await Promise.all(
    uploads.map(async (u) => {
      const blob = await new Promise<Blob>((resolve, reject) =>
        picked[u.index].image.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.93),
      );
      const put = await fetch(u.url, { method: "PUT", headers: { "content-type": u.contentType }, body: blob });
      if (!put.ok) throw new Error(`upload ${u.index} failed: ${put.status}`);
    }),
  );
  const submit = await apiFetch(`/api/avatars/${avatarId}/submit`, { method: "POST" });
  return submit.ok ? { ok: true, avatarId } : { ok: false, reason: `submit_${submit.status}` };
}

export interface CloudAvatar {
  id: string;
  status: "uploading" | "queued" | "processing" | "ready" | "failed";
  model_url: string | null;
  rig: unknown;
  analysis: unknown;
  natural_hair: (Record<string, unknown> & { bakedBeard?: number; skinRgb?: [number, number, number] }) | null;
  error: string | null;
}

export async function fetchCloudAvatar(id: string): Promise<CloudAvatar | null> {
  const res = await apiFetch(`/api/avatars/${id}`);
  return res.ok ? ((await res.json()) as CloudAvatar) : null;
}
