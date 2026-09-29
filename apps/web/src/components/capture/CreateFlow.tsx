"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AdditiveBlending, BufferGeometry, Float32BufferAttribute, type Points } from "three";
import { isPaid, useAccount } from "@/lib/account";
import { startHdTwin } from "@/lib/recon/hd";
import { reconstructInstantTwin } from "@/lib/recon/reconstruct";
import { setActiveAvatarId } from "@/lib/recon/storage";
import type { CaptureFrame, ReconProgress } from "@/lib/recon/types";
import { haptic } from "@/lib/telegram/webapp";
import { GuidedScan } from "@/components/capture/GuidedScan";
import { UploadPhotos } from "@/components/capture/UploadPhotos";
import { IconCamera, IconShield, IconUpload } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/Logo";
import { easeOut } from "@/components/ui/primitives";

type Step = "choose" | "scan" | "upload" | "building" | "error";

export function CreateFlow({ studioPath = "/studio" }: { studioPath?: string }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>("choose");
  const [frames, setFrames] = useState<CaptureFrame[]>([]);
  const [progress, setProgress] = useState<ReconProgress>({ stage: "segment", progress: 0, message: "" });
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    useAccount.getState().refresh();
  }, []);
  const plan = useAccount((s) => s.account.plan);
  const [hd, setHd] = useState(false);

  const build = useCallback(
    async (fs: CaptureFrame[]) => {
      setFrames(fs);
      setStep("building");
      try {
        const rec = await reconstructInstantTwin(fs, setProgress);
        setActiveAvatarId(rec.id);
        if (hd) {
          // The Instant Twin is ready now; the HD Twin builds in the cloud and notifies when done.
          startHdTwin(fs, rec.analysis).then((r) => console.info("[hd]", r)).catch((e) => console.warn("[hd] failed", e));
        }
        haptic("success");
        router.push(`${studioPath}?avatar=${rec.id}`);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setStep("error");
        haptic("error");
      }
    },
    [router, studioPath, hd],
  );

  return (
    <main className="relative min-h-dvh overflow-hidden bg-ink-950 text-mist-100">
      <AnimatePresence mode="wait">
        {step === "choose" && (
          <motion.section key="choose" exit={{ opacity: 0 }} className="relative mx-auto flex min-h-dvh max-w-5xl flex-col px-5 pb-10 pt-[calc(var(--tg-safe-top)+20px)] md:px-8">
            <div className="absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_20%,#1a1b21,transparent)]" />
            <Link href="/" className="self-start">
              <Wordmark />
            </Link>
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, ease: easeOut }} className="mt-[10vh]">
              <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-mist-500">Step 1 of 2</p>
              <h1 className="mt-3 max-w-2xl font-display text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[56px]">
                Let&apos;s capture <span className="font-serif font-normal italic text-mist-300">you</span>, in 3D.
              </h1>
              <p className="mt-4 max-w-lg text-[16px] leading-7 text-mist-400">Seven angles are all it takes. We fuse them into a sculpted head and a 2K skin texture — on this device.</p>
            </motion.div>
            <div className="mt-10 grid gap-3 md:grid-cols-2">
              <Choice
                delay={0.15}
                onClick={() => setStep("scan")}
                icon={<IconCamera size={22} />}
                title="Guided scan"
                badge="Recommended · 15 s"
                text="Turn your head slowly while the camera tracks 478 points. Captures itself when each angle is sharp."
              />
              <Choice
                delay={0.25}
                onClick={() => setStep("upload")}
                icon={<IconUpload size={22} />}
                title="Upload photos or a video"
                badge="5–15 photos"
                text="Front, both sides, chin up and down. Selfie video works too."
              />
            </div>
            {isPaid(plan) && (
              <label className="glass-soft mt-4 flex cursor-pointer items-center justify-between gap-4 rounded-[22px] px-5 py-4">
                <span>
                  <span className="block text-[14px] font-medium text-mist-100">Also build an HD Twin in the cloud</span>
                  <span className="mt-0.5 block text-[12px] leading-5 text-mist-400">GPU-fitted head model and a sharper skin texture. Photos are uploaded encrypted and deleted within 24 hours.</span>
                </span>
                <input type="checkbox" checked={hd} onChange={(e) => setHd(e.target.checked)} className="size-5 accent-mist-50" />
              </label>
            )}
            <div className="mt-8 flex items-start gap-3 text-[13px] leading-5 text-mist-400">
              <IconShield size={18} className="mt-0.5 shrink-0 text-ok-400" />
              <p>
                Private by design: your photos are processed in the browser and never uploaded. Only if you later choose an HD twin do they go to our GPU cloud — encrypted,
                and deleted within 24 hours.
              </p>
            </div>
          </motion.section>
        )}

        {step === "scan" && (
          <motion.div key="scan" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <GuidedScan hd={false} onCancel={() => setStep("upload")} onDone={build} />
          </motion.div>
        )}

        {step === "upload" && (
          <motion.div key="upload" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <UploadPhotos onBack={() => setStep("choose")} onDone={build} />
          </motion.div>
        )}

        {(step === "building" || step === "error") && (
          <motion.section key="building" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="fixed inset-0 flex flex-col items-center justify-center px-6">
            <div className="absolute inset-0">
              <Canvas camera={{ position: [0, 0, 2.4], fov: 32 }} dpr={[1, 2]}>
                <LandmarkCloud frames={frames} />
              </Canvas>
            </div>
            <div className="relative mt-[46vh] w-full max-w-sm text-center">
              {step === "error" ? (
                <>
                  <p className="font-display text-[20px] font-semibold">That didn&apos;t work</p>
                  <p className="mt-2 text-[14px] text-mist-400">{error}</p>
                  <button onClick={() => setStep("choose")} className="mt-5 text-[14px] text-iris-300">
                    Try again
                  </button>
                </>
              ) : (
                <>
                  <AnimatePresence mode="wait">
                    <motion.p key={progress.message} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} className="text-shimmer font-display text-[18px] font-medium">
                      {progress.message || "Starting"}
                    </motion.p>
                  </AnimatePresence>
                  <div className="mx-auto mt-5 h-[3px] w-56 overflow-hidden rounded-full bg-white/10">
                    <motion.div className="h-full rounded-full bg-mist-100" animate={{ width: `${Math.round(progress.progress * 100)}%` }} transition={{ ease: easeOut, duration: 0.6 }} />
                  </div>
                  <p className="mt-3 text-[12px] text-mist-500">Running on your device · nothing is uploaded</p>
                </>
              )}
            </div>
          </motion.section>
        )}
      </AnimatePresence>
    </main>
  );
}

function Choice(p: { onClick: () => void; icon: React.ReactNode; title: string; badge: string; text: string; delay: number }) {
  return (
    <motion.button
      initial={{ opacity: 0, y: 18 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: easeOut, delay: p.delay }}
      onClick={p.onClick}
      className="glass group flex flex-col items-start gap-5 rounded-[30px] p-6 text-left transition-transform duration-300 hover:-translate-y-1 md:p-7"
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-white/[0.07] text-mist-50">{p.icon}</span>
      <span>
        <span className="block text-[12px] font-medium uppercase tracking-[0.12em] text-mist-500">{p.badge}</span>
        <span className="mt-1.5 block font-display text-[22px] font-semibold tracking-[-0.02em] text-mist-50">{p.title}</span>
        <span className="mt-2 block text-[14px] leading-6 text-mist-400">{p.text}</span>
      </span>
    </motion.button>
  );
}

/** The landmarks of every captured view, orbiting while the twin is built. */
function LandmarkCloud({ frames }: { frames: CaptureFrame[] }) {
  const ref = useRef<Points>(null);
  const geo = useMemo(() => {
    const pts: number[] = [];
    // The most frontal view gives a clean, readable face cloud.
    const f = [...frames].sort((a, b) => Math.abs(a.pose.yaw) - Math.abs(b.pose.yaw))[0];
    if (f) {
      const ar = f.width / f.height;
      for (let i = 0; i < 478; i++) {
        pts.push((f.landmarks[i * 3] - 0.5) * ar * 3.2, -(f.landmarks[i * 3 + 1] - 0.5) * 3.2, -f.landmarks[i * 3 + 2] * ar * 3.2);
      }
    }
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    g.center();
    return g;
  }, [frames]);
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.5;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.016} color="#c2ccff" transparent opacity={0.8} blending={AdditiveBlending} depthWrite={false} sizeAttenuation />
    </points>
  );
}
