"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { toFrame, snapshot } from "@/lib/recon/capture";
import type { FaceLandmarker, FaceLandmarkerResult } from "@mediapipe/tasks-vision";
import { fallBackToCpu, getFaceLandmarker, poseFromMatrix, preloadFaceTracking } from "@/lib/recon/mediapipe";
import { POSE_TARGETS, REQUIRED_BINS, binForPose, mergeFrame, measureFrame } from "@/lib/recon/poses";
import type { CaptureFrame, PoseBinId } from "@/lib/recon/types";
import { getTelegram, haptic } from "@/lib/telegram/webapp";

type Hint = "noface" | "center" | "closer" | "back" | "level" | "light" | "still" | null;
type Phase = "camera" | "tap" | "loading" | "tracking" | "error";
/** align: frame the face and look straight (captures the front view); circle: roll the head around. */
type Stage = "align" | "circle" | "done";

/** Frames fed to the landmarker are downscaled (landmarks are normalised, so capture stays full-res). */
const FEED_WIDTH = 480;
/** Phone front cameras: ~23–26 mm equivalent → focal ≈ 0.7 × the long side of a 4:3 frame. */
const FRONT_CAMERA_FOCAL = 0.7;
const TICKS = 72;
/** Head rotation that completes the ring: wide left/right (the cheeks and ears need it), gentle up/down. */
const YAW_FULL = 44;
const PITCH_FULL = 15;
/** The scan screen is light on purpose: it lights the face like a soft box (a dim room is the #1 cause of dark twins). */
const PAPER = "#f7f4ef";

function cameraError(e: unknown): string {
  const name = e instanceof DOMException ? e.name : "";
  if (name === "NotAllowedError" || name === "SecurityError")
    return "Camera access is blocked. Allow it for this site in your browser settings, or upload photos instead.";
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

/** Screen direction of a head pose, as in the mirrored preview: x right, y up, 1 = a full turn. */
function screenDir(yaw: number, pitch: number) {
  return { x: -yaw / YAW_FULL, y: -pitch / PITCH_FULL };
}

/** Where to turn for a pose bin, in words. */
const BIN_WORDS: Partial<Record<PoseBinId, string>> = {
  left30: "Turn a little to your left and hold",
  left55: "Turn further to your left and hold",
  right30: "Turn a little to your right and hold",
  right55: "Turn further to your right and hold",
  up: "Tilt your chin up and hold",
  down: "Tilt your chin down and hold",
};

/**
 * Face-ID-style guided capture: frame your face in the circle (the front view
 * is taken automatically), then roll your head slowly in a circle while a ring
 * of ticks fills in every direction you've covered. Frames are kept
 * automatically when the head is in a pose bin, sharp, well lit and not
 * moving too fast; the best frame per bin wins.
 *
 * Every stage reports its state (camera → loading → tracking), failures are
 * never silent, and the tracker falls back to the CPU delegate when the GPU
 * path misbehaves (common in mobile WebKit).
 */
export function GuidedScan({
  onDone,
  onCancel,
  onUpload,
  hd,
}: {
  onDone: (frames: CaptureFrame[]) => void;
  onCancel: () => void;
  onUpload?: () => void;
  hd: boolean;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const bins = useRef(new Map<PoseBinId, CaptureFrame>());
  const ticks = useRef(new Float32Array(TICKS));
  const tapToStart = useRef<(() => void) | null>(null);
  const [filled, setFilled] = useState<PoseBinId[]>([]);
  const [stage, setStage] = useState<Stage>("align");
  const [view, setView] = useState({ ticks: new Float32Array(TICKS), dir: -1 });
  const [hint, setHint] = useState<Hint>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [error, setError] = useState<string | null>(null);
  const [flash, setFlash] = useState(0);
  const required = hd ? POSE_TARGETS.map((p) => p.id) : REQUIRED_BINS;
  const stageRef = useRef<Stage>("align");
  stageRef.current = stage;

  // Inside Telegram, match the native header to the light scan screen.
  useEffect(() => {
    const tg = getTelegram();
    if (!tg) return;
    tg.setHeaderColor(PAPER);
    tg.setBackgroundColor(PAPER);
    tg.setBottomBarColor?.(PAPER);
    return () => {
      tg.setHeaderColor("#0b0a09");
      tg.setBackgroundColor("#0b0a09");
      tg.setBottomBarColor?.("#0b0a09");
    };
  }, []);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;
    let last = { yaw: 0, pitch: 0, t: 0 };
    let frameNo = 0;
    let lastQuality = { brightness: 128, faceScale: 0.4, sharpness: 100 };
    let stillSince = 0;
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
          video: {
            facingMode: "user",
            // As sharp as the front camera streams (texture detail around the eyes needs it).
            width: { ideal: 1920 },
            height: { ideal: 1440 },
          },
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
      let pendingHint: Hint = null;
      let pendingSince = 0;
      let shownHint: Hint = null;
      const showHint = (h: Hint, now: number) => {
        if (h !== pendingHint) {
          pendingHint = h;
          pendingSince = now;
        }
        if (h !== shownHint && now - pendingSince > (h === null ? 150 : 400)) {
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
      const keep = (res: FaceLandmarkerResult, bin: PoseBinId) => {
        const image = snapshot(v, v.videoWidth, v.videoHeight);
        const frame = toFrame(res, image, "guided");
        if (!frame || frame.quality.issues.includes("blurry")) return false;
        frame.focal = FRONT_CAMERA_FOCAL;
        frame.bin = bin;
        const isNew = !bins.current.has(bin);
        if (mergeFrame(bins.current, frame) && isNew) {
          setFilled([...bins.current.keys()]);
          setFlash((f) => f + 1);
          haptic("tap");
          return true;
        }
        return false;
      };
      let lastPaint = 0;

      const loop = () => {
        if (stopped) return;
        raf = requestAnimationFrame(loop);
        if (swapping || v.readyState < 2 || !v.videoWidth || stageRef.current === "done") return;
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
          showHint(lost > 1500 ? "noface" : shownHint, now);
          stillSince = 0;
          return;
        }
        lastFace = now;
        const p = poseFromMatrix(res.facialTransformationMatrixes[0].data);
        const dt = Math.max(1, now - last.t) / 1000;
        const speed = Math.hypot(p.yaw - last.yaw, p.pitch - last.pitch) / dt;
        last = { yaw: p.yaw, pitch: p.pitch, t: now };

        const lms = res.faceLandmarks[0];
        if (frameNo % 5 === 0)
          lastQuality = measureFrame(
            feed,
            feed.width,
            feed.height,
            lms.flatMap((l) => [l.x, l.y, l.z]),
          );
        // Framing, in the circle's own terms: the preview shows the centred square of the video.
        const side = Math.min(v.videoWidth, v.videoHeight);
        const nose = lms[1];
        const offX = ((nose.x - 0.5) * v.videoWidth) / side;
        const offY = ((nose.y - 0.45) * v.videoHeight) / side;
        const faceInCircle = (lastQuality.faceScale * v.videoHeight) / side;

        const s = stageRef.current;
        let hintNow: Hint =
          lastQuality.brightness < 55
            ? "light"
            : faceInCircle < 0.34
              ? "closer"
              : faceInCircle > 0.95
                ? "back"
                : s === "align" && Math.hypot(offX, offY) > 0.2
                  ? "center"
                  : null;
        if (!hintNow && s === "align" && Math.abs(p.pitch) > 16 && Math.abs(p.yaw) < 15) hintNow = "level";
        if (!hintNow && speed > (s === "align" ? 25 : 80)) hintNow = "still";
        showHint(hintNow, now);

        if (s === "align") {
          const frontal = Math.abs(p.yaw) < 9 && Math.abs(p.pitch) < 12;
          if (hintNow || !frontal) {
            stillSince = 0;
            return;
          }
          stillSince ||= now;
          if (now - stillSince > 350 && keep(res, "front")) {
            haptic("success");
            setStage("circle");
          }
          return;
        }

        // circle: light up the ticks the head points at
        const d = screenDir(p.yaw, p.pitch);
        const mag = Math.hypot(d.x, d.y);
        let dir = -1;
        if (!hintNow && mag > 0.2) {
          const ang = Math.atan2(d.y, d.x);
          dir = Math.round(((ang < 0 ? ang + Math.PI * 2 : ang) / (Math.PI * 2)) * TICKS) % TICKS;
          for (let k = -2; k <= 2; k++) {
            const i = (dir + k + TICKS) % TICKS;
            ticks.current[i] = Math.max(ticks.current[i], Math.min(1, mag * (1 - Math.abs(k) * 0.04)));
          }
        }
        if (now - lastPaint > 60) {
          lastPaint = now;
          setView({ ticks: ticks.current.slice(), dir });
        }

        // keep the best frame for whichever pose bin the head is in
        const bin = binForPose(p.yaw, p.pitch);
        if (!bin || !required.includes(bin.id) || hintNow) return;
        const cur = bins.current.get(bin.id);
        if (cur && cur.quality.score > 0.8) return;
        keep(res, bin.id);
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

  const ringDone = view.ticks.every((t) => t >= 1);
  const missing = required.filter((r) => !filled.includes(r));
  useEffect(() => {
    if (stage === "circle" && missing.length === 0) {
      setStage("done");
      haptic("success");
    }
  }, [stage, missing.length]);
  useEffect(() => {
    if (stage !== "done") return;
    const t = setTimeout(() => onDone([...bins.current.values()]), 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const canFinishEarly = stage === "circle" && ["front", "left30", "right30"].every((b) => filled.includes(b as PoseBinId)) && filled.length >= 5;
  const hintText: Record<Exclude<Hint, null>, string> = {
    noface: "Show your face to the camera",
    center: "Fit your face in the circle",
    closer: "Move a little closer",
    back: "Move back a little",
    level: "Hold your phone at eye level",
    light: "Find brighter light",
    still: stage === "align" ? "Hold still" : "A bit slower",
  };

  // Which part of the ring is still open, in words (the largest unfilled arc).
  const openWords = (() => {
    if (!ringDone) {
      let best = -1,
        bestLen = 0;
      for (let k = 0; k < TICKS; k++) {
        if (view.ticks[k] >= 1) continue;
        let len = 0;
        while (len < TICKS && view.ticks[(k + len) % TICKS] < 1) len++;
        if (len > bestLen) {
          bestLen = len;
          best = (k + len / 2) % TICKS;
        }
      }
      const covered = view.ticks.filter((t) => t >= 1).length;
      if (covered < TICKS * 0.12) return "Slowly move your head in a circle";
      // Mirrored preview: screen-left is the user's own left.
      const where = ["right", "up and right", "up", "up and left", "left", "down and left", "down", "down and right"][Math.round((best / TICKS) * 8) % 8];
      return `Keep circling — ${where} next`;
    }
    return missing.length ? (BIN_WORDS[missing[0]] ?? "Hold still for a moment") : "Perfect";
  })();

  const message =
    error ??
    (phase === "camera"
      ? "Starting the camera…"
      : phase === "tap"
        ? "Tap to start the camera"
        : phase === "loading"
          ? "Getting face tracking ready…"
          : stage === "done"
            ? "Perfect. Building your twin…"
            : hint
              ? hintText[hint]
              : stage === "align"
                ? "Look straight at the camera"
                : openWords);
  const detail =
    error || phase !== "tracking"
      ? phase === "camera"
        ? "Allow camera access when your phone asks"
        : phase === "loading"
          ? "The first time takes a few seconds"
          : null
      : stage === "align"
        ? "Step 1 of 2 · we'll take it automatically"
        : stage === "circle"
          ? "Step 2 of 2 · like setting up Face ID"
          : null;

  return (
    <div className="fixed inset-0 flex flex-col items-center overflow-hidden text-ink-950" style={{ background: PAPER }}>
      <div className="flex w-full items-center justify-between px-4 pt-[calc(var(--tg-safe-top)+14px)]">
        <button onClick={onCancel} className="h-9 rounded-full bg-ink-950/[0.06] px-4 text-[14px] font-medium text-ink-800 active:bg-ink-950/10">
          Cancel
        </button>
        <span className="text-[12px] font-medium tabular-nums text-ink-500">
          {filled.filter((f) => required.includes(f)).length} / {required.length}
        </span>
      </div>

      <div className="mt-[max(2vh,8px)] flex min-h-[92px] w-full flex-1 flex-col items-center justify-center px-6 text-center">
        <div className="flex min-h-[92px] flex-col items-center">
          <motion.p
            key={message}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.22 }}
            className="font-display text-[24px] font-semibold leading-tight tracking-[-0.01em]"
          >
            {message}
          </motion.p>
          {detail && <p className="mt-2 text-[14px] text-ink-500">{detail}</p>}
        </div>

        <div className="relative mt-[5vh]" style={{ width: "min(76vw, 48vh, 400px)", aspectRatio: "1" }}>
          <div className="absolute inset-0 overflow-hidden rounded-full bg-ink-950 shadow-[0_30px_80px_-30px_rgba(40,30,20,0.45)]">
            <video ref={video} playsInline muted className="size-full -scale-x-100 object-cover" />
            {(phase === "camera" || phase === "loading") && (
              <div className="absolute inset-0 grid place-items-center" aria-live="polite">
                <span className="size-9 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
              </div>
            )}
            {phase === "tap" && (
              <button onClick={() => tapToStart.current?.()} className="absolute inset-0 grid place-items-center text-[15px] font-semibold text-mist-50">
                Tap to start the camera
              </button>
            )}
            <AnimatePresence>
              <motion.div
                key={flash}
                initial={{ opacity: flash ? 0.45 : 0 }}
                animate={{ opacity: 0 }}
                transition={{ duration: 0.45 }}
                className="pointer-events-none absolute inset-0 bg-white"
              />
            </AnimatePresence>
          </div>
          <ScanRing ticks={view.ticks} dir={stage === "circle" ? view.dir : -1} stage={stage} />
        </div>
      </div>

      <div className="flex min-h-[72px] flex-col items-center justify-end gap-3 px-6 pb-[calc(var(--tg-safe-bottom)+28px)] text-center">
        {error ? (
          <button onClick={onUpload ?? onCancel} className="h-12 rounded-full bg-ink-950 px-6 text-[15px] font-semibold text-mist-50">
            Upload photos instead
          </button>
        ) : canFinishEarly ? (
          <button onClick={() => onDone([...bins.current.values()])} className="text-[14px] text-ink-500 underline underline-offset-4">
            Finish now with {filled.length} angles
          </button>
        ) : (
          <p className="max-w-xs text-[12px] leading-5 text-ink-500">Keep the phone still and turn only your head. Good light makes a better twin.</p>
        )}
      </div>
    </div>
  );
}

/** Ring of ticks around the camera circle (Face ID style). */
function ScanRing({ ticks, dir, stage }: { ticks: Float32Array; dir: number; stage: Stage }) {
  const R = 50; // circle radius in viewBox units (the ring sits just outside it)
  return (
    <svg className="pointer-events-none absolute -inset-[13%] size-[126%]" viewBox="-63 -63 126 126" aria-hidden>
      {Array.from({ length: TICKS }, (_, k) => {
        const a = (k / TICKS) * Math.PI * 2;
        const f = stage === "done" ? 1 : stage === "align" ? 0 : ticks[k];
        const done = f >= 1;
        const near = dir >= 0 && Math.min(Math.abs(k - dir), TICKS - Math.abs(k - dir)) <= 2;
        const r0 = R + 4;
        const r1 = r0 + 4 + 5 * f + (near ? 1.5 : 0);
        const c = Math.cos(a),
          s = -Math.sin(a); // SVG y points down; ticks go counter-clockwise from the right
        return (
          <line
            key={k}
            x1={c * r0}
            y1={s * r0}
            x2={c * r1}
            y2={s * r1}
            stroke={done ? "#1fae6b" : near ? "rgba(20,18,16,0.55)" : `rgba(20,18,16,${0.16 + 0.3 * f})`}
            strokeWidth={1.3}
            strokeLinecap="round"
            style={{ transition: "stroke 0.25s" }}
          />
        );
      })}
    </svg>
  );
}
