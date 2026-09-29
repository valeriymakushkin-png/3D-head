"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toFrame, snapshot } from "@/lib/recon/capture";
import { getFaceLandmarker, poseFromMatrix } from "@/lib/recon/mediapipe";
import { POSE_TARGETS, REQUIRED_BINS, binForPose, mergeFrame, measureFrame } from "@/lib/recon/poses";
import type { CaptureFrame, PoseBinId } from "@/lib/recon/types";
import { haptic } from "@/lib/telegram/webapp";
import { cn } from "@/lib/cn";
import { Button, easeOut } from "@/components/ui/primitives";

type Hint = "center" | "closer" | "back" | "light" | "still" | null;

/**
 * Face-ID-style guided capture. The landmarker runs on every video frame;
 * a frame is kept automatically when the head pose falls in an unfilled bin,
 * the head is still, the face is sharp, well lit and large enough.
 */
export function GuidedScan({ onDone, onCancel, hd }: { onDone: (frames: CaptureFrame[]) => void; onCancel: () => void; hd: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const bins = useRef(new Map<PoseBinId, CaptureFrame>());
  const [filled, setFilled] = useState<PoseBinId[]>([]);
  const [pose, setPose] = useState({ yaw: 0, pitch: 0, found: false });
  const [hint, setHint] = useState<Hint>("center");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const required = hd ? POSE_TARGETS.map((p) => p.id) : REQUIRED_BINS;
  const next = POSE_TARGETS.find((t) => required.includes(t.id) && !filled.includes(t.id));

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = { yaw: 0, pitch: 0, t: 0 };
    let frameNo = 0;
    let lastQuality = { brightness: 128, faceScale: 0.4, sharpness: 100 };

    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      } catch {
        setError("Camera access was blocked. You can upload photos instead.");
        return;
      }
      const v = video.current!;
      v.srcObject = stream;
      await v.play();
      const detector = await getFaceLandmarker("VIDEO");
      const work = document.createElement("canvas");

      const loop = () => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (v.readyState < 2) return;
        const now = performance.now();
        const res = detector.detectForVideo(v, now);
        frameNo++;
        if (!res.faceLandmarks.length || !res.facialTransformationMatrixes?.length) {
          setPose((p) => ({ ...p, found: false }));
          setHint("center");
          return;
        }
        const p = poseFromMatrix(res.facialTransformationMatrixes[0].data);
        const dt = Math.max(1, now - last.t) / 1000;
        const speed = Math.hypot(p.yaw - last.yaw, p.pitch - last.pitch) / dt;
        last = { yaw: p.yaw, pitch: p.pitch, t: now };
        setPose({ yaw: p.yaw, pitch: p.pitch, found: true });

        if (frameNo % 5 === 0) {
          work.width = 320;
          work.height = Math.round((320 * v.videoHeight) / v.videoWidth);
          work.getContext("2d")!.drawImage(v, 0, 0, work.width, work.height);
          const lm = res.faceLandmarks[0].flatMap((l) => [l.x, l.y, l.z]);
          lastQuality = measureFrame(work, work.width, work.height, lm);
        }
        const hintNow: Hint =
          lastQuality.faceScale < 0.28 ? "closer" : lastQuality.faceScale > 0.8 ? "back" : lastQuality.brightness < 58 ? "light" : speed > 40 ? "still" : null;
        setHint(hintNow);

        const bin = binForPose(p.yaw, p.pitch);
        if (!bin || !required.includes(bin.id) || hintNow || speed > 30) return;
        const cur = bins.current.get(bin.id);
        if (cur && cur.quality.score > 0.8) return;
        const image = snapshot(v, v.videoWidth, v.videoHeight);
        const frame = toFrame(res, image, "guided");
        if (!frame || frame.quality.issues.includes("blurry")) return;
        frame.bin = bin.id;
        if (mergeFrame(bins.current, frame) && !cur) {
          setFilled([...bins.current.keys()]);
          setFlash((f) => f + 1);
          haptic("tap");
        }
      };
      loop();
    })();

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (required.every((r) => filled.includes(r))) {
      haptic("success");
      const t = setTimeout(() => onDone([...bins.current.values()]), 700);
      return () => clearTimeout(t);
    }
  }, [filled, required, onDone]);

  const progress = filled.filter((f) => required.includes(f)).length / required.length;
  const canFinishEarly = ["front", "left30", "right30"].every((b) => filled.includes(b as PoseBinId)) && filled.length >= 4;
  const hintText: Record<Exclude<Hint, null>, string> = {
    center: "Center your face in the oval",
    closer: "Move a little closer",
    back: "Move back slightly",
    light: "Find softer, brighter light",
    still: "Hold still for a moment",
  };

  return (
    <div className="fixed inset-0 bg-black">
      <video ref={video} playsInline muted className="absolute inset-0 size-full -scale-x-100 object-cover" />
      <AnimatePresence>
        <motion.div key={flash} initial={{ opacity: 0.35 }} animate={{ opacity: 0 }} transition={{ duration: 0.5 }} className="pointer-events-none absolute inset-0 bg-white" />
      </AnimatePresence>

      {/* oval mask + progress ring */}
      <svg className="absolute inset-0 size-full" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice" aria-hidden>
        <defs>
          <mask id="oval">
            <rect width="100" height="100" fill="white" />
            <ellipse cx="50" cy="46" rx="22" ry="29" fill="black" />
          </mask>
        </defs>
        <rect width="100" height="100" fill="rgba(5,5,6,0.72)" mask="url(#oval)" />
        <ellipse cx="50" cy="46" rx="23.5" ry="30.5" fill="none" stroke="rgba(255,255,255,0.12)" strokeWidth="0.5" />
        <motion.ellipse
          cx="50"
          cy="46"
          rx="23.5"
          ry="30.5"
          fill="none"
          stroke="#f6f6f8"
          strokeWidth="0.7"
          strokeLinecap="round"
          pathLength={1}
          strokeDasharray="1 1"
          animate={{ strokeDashoffset: 1 - progress }}
          transition={{ duration: 0.6, ease: easeOut }}
          style={{ rotate: -90, transformOrigin: "50px 46px" }}
        />
      </svg>

      <div className="absolute inset-x-0 top-0 flex items-center justify-between p-4 pt-[calc(var(--tg-safe-top)+16px)]">
        <Button variant="glass" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <span className="glass rounded-full px-3 py-1.5 text-[12px] tabular-nums text-mist-200">
          {filled.filter((f) => required.includes(f)).length} / {required.length} angles
        </span>
      </div>

      <div className="absolute inset-x-0 top-[9%] text-center">
        <AnimatePresence mode="wait">
          <motion.p
            key={error ?? (hint ? hint : next?.id ?? "done")}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            className="font-display text-[22px] font-semibold tracking-[-0.02em] text-mist-50"
          >
            {error ?? (hint ? hintText[hint] : next ? next.instruction : "Perfect. Building your twin…")}
          </motion.p>
        </AnimatePresence>
      </div>

      {/* pose map: where your nose points vs. the targets (mirrored like the preview) */}
      <div className="absolute inset-x-0 bottom-0 flex flex-col items-center gap-4 pb-[calc(var(--tg-safe-bottom)+28px)]">
        <div className="glass relative h-[92px] w-[260px] rounded-[28px]">
          {POSE_TARGETS.filter((t) => required.includes(t.id)).map((t) => (
            <span
              key={t.id}
              className={cn(
                "absolute size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border transition-all duration-300",
                filled.includes(t.id) ? "border-mist-50 bg-mist-50" : t.id === next?.id ? "animate-breathe border-iris-300 bg-iris-300/30" : "border-white/30",
              )}
              style={{ left: `${50 - (t.yaw / 80) * 45}%`, top: `${50 + (t.pitch / 22) * 38}%` }}
            />
          ))}
          {pose.found && (
            <motion.span
              className="absolute size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-aura-300 shadow-[0_0_12px_#f4bf96]"
              animate={{ left: `${50 - (Math.max(-80, Math.min(80, pose.yaw)) / 80) * 45}%`, top: `${50 + (Math.max(-22, Math.min(22, pose.pitch)) / 22) * 38}%` }}
              transition={{ type: "spring", stiffness: 500, damping: 40 }}
            />
          )}
        </div>
        {error ? (
          <Button variant="solid" onClick={onCancel}>
            Upload photos instead
          </Button>
        ) : (
          canFinishEarly && (
            <button onClick={() => onDone([...bins.current.values()])} className="text-[13px] text-mist-300 underline-offset-4 hover:text-mist-50 hover:underline">
              Finish with {filled.length} angles
            </button>
          )
        )}
      </div>
    </div>
  );
}
