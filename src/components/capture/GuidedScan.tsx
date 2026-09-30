"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toFrame, snapshot } from "@/lib/recon/capture";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { fallBackToCpu, getFaceLandmarker, poseFromMatrix, preloadFaceTracking } from "@/lib/recon/mediapipe";
import { POSE_TARGETS, REQUIRED_BINS, binForPose, mergeFrame, measureFrame } from "@/lib/recon/poses";
import type { CaptureFrame, PoseBinId } from "@/lib/recon/types";
import { haptic } from "@/lib/telegram/webapp";
import { cn } from "@/lib/cn";
import { Button, easeOut } from "@/components/ui/primitives";

type Hint = "center" | "noface" | "closer" | "back" | "light" | "still" | null;
type Phase = "camera" | "tap" | "loading" | "tracking" | "error";

/** Frames fed to the landmarker are downscaled (landmarks are normalised, so capture stays full-res). */
const FEED_WIDTH = 480;

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access is blocked. Allow it for this site in your browser settings, or upload photos instead.";
  if (name === "NotFoundError" || name === "OverconstrainedError") return "No front camera found. You can upload photos instead.";
  if (name === "NotReadableError" || name === "AbortError") return "The camera is busy in another app. Close it and try again, or upload photos.";
  return "This browser can't open the camera here. Try Safari or Chrome, or upload photos instead.";
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("timeout")), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e)),
    );
  });
}

/**
 * Face-ID-style guided capture. The landmarker runs on every video frame;
 * a frame is kept automatically when the head pose falls in an unfilled bin,
 * the head is still, the face is sharp, well lit and large enough.
 *
 * Every stage reports its state (camera → loading → tracking), failures are
 * never silent, and the tracker falls back to the CPU delegate when the GPU
 * path misbehaves (common in mobile WebKit).
 */
export function GuidedScan({ onDone, onCancel, hd }: { onDone: (frames: CaptureFrame[]) => void; onCancel: () => void; hd: boolean }) {
  const video = useRef<HTMLVideoElement>(null);
  const bins = useRef(new Map<PoseBinId, CaptureFrame>());
  const tapToStart = useRef<(() => void) | null>(null);
  const [filled, setFilled] = useState<PoseBinId[]>([]);
  const [pose, setPose] = useState({ yaw: 0, pitch: 0, found: false });
  const [hint, setHint] = useState<Hint>("center");
  const [phase, setPhase] = useState<Phase>("camera");
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
    const fail = (message: string) => {
      if (stopped) return;
      setError(message);
      setPhase("error");
      haptic("error");
    };

    (async () => {
      // Start the ~12 MB runtime download while the permission prompt is up.
      preloadFaceTracking();
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error("unsupported");
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 1280 }, height: { ideal: 960 } },
          audio: false,
        });
      } catch (e) {
        return fail(cameraError(e));
      }
      if (stopped) return stream.getTracks().forEach((t) => t.stop());
      const v = video.current!;
      v.muted = true;
      v.setAttribute("muted", "");
      v.setAttribute("playsinline", "");
      v.srcObject = stream;
      try {
        await v.play();
      } catch {
        if (stopped) return;
        // Some WebViews only start video from a direct tap.
        setPhase("tap");
        await new Promise<void>((resolve) => (tapToStart.current = resolve));
        try {
          await v.play();
        } catch (e) {
          return fail(cameraError(e));
        }
      }
      if (stopped) return;

      setPhase("loading");
      let detector: FaceLandmarker;
      try {
        detector = await withTimeout(getFaceLandmarker("VIDEO"), 60_000);
      } catch (e) {
        console.error("[scan] face tracking failed to load", e);
        return fail("Face tracking couldn't load. Check your connection and try again, or upload photos instead.");
      }
      if (stopped) return;
      setPhase("tracking");

      const feed = document.createElement("canvas");
      const feedCtx = feed.getContext("2d", { willReadFrequently: true })!;
      let ts = 0;
      let errors = 0;
      let swapping = false;
      let lastFace = performance.now();
      // Hints only change once they've held for a moment, so the headline never flickers.
      let pendingHint: Hint = "center";
      let pendingSince = 0;
      let shownHint: Hint = "center";
      const showHint = (h: Hint, now: number) => {
        if (h !== pendingHint) {
          pendingHint = h;
          pendingSince = now;
        }
        if (h !== shownHint && now - pendingSince > 350) {
          shownHint = h;
          setHint(h);
        }
      };
      const switchToCpu = () => {
        if (swapping || !fallBackToCpu()) return false;
        swapping = true;
        getFaceLandmarker("VIDEO")
          .then((d) => (detector = d))
          .catch(() => fail("Face tracking isn't supported on this device. You can upload photos instead."))
          .finally(() => (swapping = false));
        return true;
      };

      const loop = () => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (swapping || v.readyState < 2 || !v.videoWidth) return;
        const now = performance.now();
        feed.width = FEED_WIDTH;
        feed.height = Math.round((FEED_WIDTH * v.videoHeight) / v.videoWidth);
        feedCtx.drawImage(v, 0, 0, feed.width, feed.height);
        let res: FaceLandmarkerResult;
        try {
          ts = Math.max(ts + 1, Math.round(now));
          res = detector.detectForVideo(feed, ts);
          errors = 0;
        } catch (e) {
          console.warn("[scan] tracking error", e);
          if (++errors >= 5 && !switchToCpu()) fail("Face tracking stopped working on this device. You can upload photos instead.");
          return;
        }
        frameNo++;
        if (!res.faceLandmarks.length || !res.facialTransformationMatrixes?.length) {
          const lost = now - lastFace;
          // A GPU delegate that initialises but never finds a face: retry once on CPU.
          if (lost > 6000 && switchToCpu()) lastFace = now;
          setPose((p) => (p.found ? { ...p, found: false } : p));
          showHint(lost > 3000 ? "noface" : "center", now);
          return;
        }
        lastFace = now;
        const p = poseFromMatrix(res.facialTransformationMatrixes[0].data);
        const dt = Math.max(1, now - last.t) / 1000;
        const speed = Math.hypot(p.yaw - last.yaw, p.pitch - last.pitch) / dt;
        last = { yaw: p.yaw, pitch: p.pitch, t: now };
        setPose({ yaw: p.yaw, pitch: p.pitch, found: true });

        if (frameNo % 5 === 0) {
          const lm = res.faceLandmarks[0].flatMap((l) => [l.x, l.y, l.z]);
          lastQuality = measureFrame(feed, feed.width, feed.height, lm);
        }
        const hintNow: Hint =
          lastQuality.faceScale < 0.28 ? "closer" : lastQuality.faceScale > 0.8 ? "back" : lastQuality.brightness < 58 ? "light" : speed > 40 ? "still" : null;
        showHint(hintNow, now);

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
    })().catch((e) => {
      console.error("[scan]", e);
      fail("Something went wrong starting the scan. You can upload photos instead.");
    });

    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      tapToStart.current?.();
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
    noface: "Can't see your face yet — hold the phone at eye level",
    closer: "Move a little closer",
    back: "Move back slightly",
    light: "Find softer, brighter light",
    still: "Hold still for a moment",
  };

  const message =
    error ??
    (phase === "camera"
      ? "Starting the camera…"
      : phase === "tap"
        ? "Tap to start the camera"
        : phase === "loading"
          ? "Getting face tracking ready…"
          : hint
            ? hintText[hint]
            : next
              ? next.instruction
              : "Perfect. Building your twin…");
  const messageKey = error ? "error" : phase === "tracking" ? (hint ?? next?.id ?? "done") : phase;
  const detail =
    phase === "camera" ? "Allow camera access when your phone asks" : phase === "loading" ? "The first time takes a few seconds" : phase === "tracking" && hint === "noface" ? "Good, even light on your face helps" : null;

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
          initial={{ strokeDashoffset: 1 }}
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

      <div className="absolute inset-x-0 top-[9%] px-6 text-center">
        {/* No exit animation: the headline must always show the current instruction. */}
        <motion.div key={messageKey} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25 }}>
          <p className="font-display text-[22px] font-semibold leading-tight text-mist-50">{message}</p>
          {detail && <p className="mt-2 text-[14px] text-mist-300">{detail}</p>}
        </motion.div>
      </div>

      {(phase === "camera" || phase === "loading") && (
        <div className="absolute inset-0 grid place-items-center" aria-live="polite">
          <span className="size-9 animate-spin rounded-full border-2 border-white/15 border-t-white/80" />
        </div>
      )}
      {phase === "tap" && (
        <div className="absolute inset-0 grid place-items-center">
          <Button variant="solid" onClick={() => tapToStart.current?.()}>
            Start camera
          </Button>
        </div>
      )}

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
