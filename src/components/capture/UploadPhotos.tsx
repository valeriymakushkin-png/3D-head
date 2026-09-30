"use client";

import { motion } from "framer-motion";
import { useRef, useState } from "react";
import { framesFromPhotos, framesFromVideo } from "@/lib/recon/capture";
import { POSE_TARGETS, REQUIRED_BINS, mergeFrame } from "@/lib/recon/poses";
import type { CaptureFrame, PoseBinId } from "@/lib/recon/types";
import { cn } from "@/lib/cn";
import { IconCheck, IconUpload } from "@/components/ui/icons";
import { Button, easeOut } from "@/components/ui/primitives";

/** 5–15 photos or a ≤30 s selfie video, binned by detected head pose. */
export function UploadPhotos({ onDone, onBack }: { onDone: (frames: CaptureFrame[]) => void; onBack: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [bins, setBins] = useState(new Map<PoseBinId, CaptureFrame>());
  const [extra, setExtra] = useState<CaptureFrame[]>([]);
  const [status, setStatus] = useState<string | null>(null);
  const [rejected, setRejected] = useState<string[]>([]);
  const [drag, setDrag] = useState(false);

  const ingest = async (files: File[]) => {
    const photos = files.filter((f) => f.type.startsWith("image/")).slice(0, 15);
    const videos = files.filter((f) => f.type.startsWith("video/"));
    const next = new Map(bins);
    const leftovers: CaptureFrame[] = [...extra];
    if (photos.length) {
      const { frames, rejected: rj } = await framesFromPhotos(photos, (d, t) => setStatus(`Reading faces · ${d}/${t}`));
      setRejected((r) => [...r, ...rj]);
      for (const f of frames) if (!mergeFrame(next, f)) leftovers.push(f);
    }
    for (const v of videos) {
      const frames = await framesFromVideo(v, (p) => setStatus(`Scanning video · ${Math.round(p * 100)}%`));
      for (const f of frames) mergeFrame(next, f);
    }
    setBins(next);
    setExtra(leftovers.slice(0, 6));
    setStatus(null);
  };

  const all = [...bins.values()];
  const haveRequired = ["front", "left30", "right30"].every((b) => bins.has(b as PoseBinId));
  const missing = REQUIRED_BINS.filter((b) => !bins.has(b));

  return (
    <div className="mx-auto flex min-h-dvh max-w-3xl flex-col px-5 pb-10 pt-[calc(var(--tg-safe-top)+24px)]">
      <button onClick={onBack} className="self-start text-[13px] text-mist-400 hover:text-mist-100">
        ← Back
      </button>
      <h1 className="mt-6 font-display text-[34px] font-semibold leading-tight tracking-[-0.015em]">Upload your angles</h1>
      <p className="mt-2 max-w-md text-[15px] leading-6 text-mist-400">
        5–15 photos of your head from different sides, or one 15-second selfie video turning slowly. Even light, no hats, glasses off.
      </p>

      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          ingest([...e.dataTransfer.files]);
        }}
        className={cn(
          "glass-soft mt-8 flex cursor-pointer flex-col items-center justify-center gap-3 rounded-[28px] border border-dashed px-6 py-12 text-center transition-colors",
          drag ? "border-mist-200 bg-white/[0.06]" : "border-white/15 hover:bg-white/[0.04]",
        )}
      >
        <IconUpload size={28} className="text-mist-300" />
        <span className="text-[15px] font-medium text-mist-100">{status ?? "Drop photos or a video, or tap to choose"}</span>
        <span className="text-[12px] text-mist-500">JPG, PNG, HEIC, MP4, MOV · processed on your device</span>
        <input ref={input} type="file" accept="image/*,video/*" multiple className="hidden" onChange={(e) => e.target.files && ingest([...e.target.files])} />
      </label>

      <div className="mt-8 grid grid-cols-3 gap-2.5 sm:grid-cols-5">
        {POSE_TARGETS.filter((t) => t.required).map((t) => {
          const f = bins.get(t.id);
          return (
            <motion.div key={t.id} layout className="relative aspect-[3/4] overflow-hidden rounded-2xl bg-ink-800 ring-1 ring-white/[0.06]">
              {f ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={f.image.toDataURL("image/jpeg", 0.6)} alt="" className="absolute inset-0 size-full object-cover" />
              ) : (
                <div className="absolute inset-0 grid place-items-center text-[11px] text-mist-500">Needed</div>
              )}
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/70 px-2 pb-1.5 pt-4">
                <span className="text-[11px] font-medium text-mist-100">{t.id.replace(/(\d+)/, " $1°").replace("left", "Left").replace("right", "Right").replace("front", "Front").replace("up", "Chin up").replace("down", "Chin down")}</span>
                {f && <IconCheck size={13} className="text-ok-400" />}
              </div>
            </motion.div>
          );
        })}
      </div>
      {rejected.length > 0 && <p className="mt-3 text-[12px] text-warn-400">No face found in: {rejected.slice(0, 4).join(", ")}</p>}
      {all.length > 0 && missing.length > 0 && (
        <p className="mt-3 text-[13px] text-mist-400">Add {missing.map((m) => POSE_TARGETS.find((t) => t.id === m)!.instruction.toLowerCase()).slice(0, 2).join(" and ")} for a sharper twin.</p>
      )}

      <motion.div initial={false} animate={{ opacity: haveRequired ? 1 : 0.4 }} transition={{ ease: easeOut }} className="mt-auto pt-10">
        <Button variant="solid" size="lg" className="w-full" disabled={!haveRequired || !!status} onClick={() => onDone([...all, ...extra])}>
          Build my twin from {all.length + extra.length} photos
        </Button>
        {!haveRequired && <p className="mt-2 text-center text-[12px] text-mist-500">Front, left and right are the minimum.</p>}
      </motion.div>
    </div>
  );
}
