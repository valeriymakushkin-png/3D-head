"use client";

import { OrbitControls } from "@react-three/drei";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useState } from "react";
import { Avatar } from "@/components/three/Avatar";
import { AvatarCanvas } from "@/components/three/AvatarCanvas";
import { StudioStage } from "@/components/three/Stage";
import { DEFAULT_LOOK, type Look, applyLookPatch } from "@/lib/avatar/look";
import { type HeadAsset, loadTemplateHead } from "@/lib/head/asset";
import { detectQuality } from "@/store/studio";
import type { QualityTier } from "@/lib/engine/protocol";

const SHOWREEL: Array<{ label: string; look: Look }> = [
  { label: "Quiff", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "quiff", color: "dark_brown" } }) },
  { label: "Textured Crop · Rectangle frames", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "textured_crop", color: "dark_brown" }, glasses: { style: "rectangle" } }) },
  { label: "Pompadour · Full beard", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "pompadour", color: "black" }, beard: { style: "full" } }) },
  { label: "Buzz Cut · Aviators", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "buzz_cut", color: "dark_brown" }, glasses: { style: "aviator" } }) },
  { label: "French Crop · Round frames", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "french_crop", color: "black" }, glasses: { style: "round" } }) },
  { label: "Undercut · Platinum", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "undercut", color: "platinum" }, beard: { style: "clean" } }) },
];

/** Live, real-time 3D showreel — not a video. Drag to rotate. */
export function HeroTwin() {
  const [asset, setAsset] = useState<HeadAsset | null>(null);
  const [i, setI] = useState(0);
  // Phones: the twin sits in the top of the screen, seen from slightly above.
  const [compact] = useState(() => typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches);
  const [quality] = useState<QualityTier>(() => (typeof window === "undefined" ? "medium" : detectQuality() === "high" ? "medium" : "low"));
  // Reveal the twin only once its first hairstyle exists — never a bald mannequin.
  const [ready, setReady] = useState(false);
  useEffect(() => {
    loadTemplateHead().then(setAsset).catch(console.error);
  }, []);
  useEffect(() => {
    if (!asset || ready) return;
    const t = setTimeout(() => setReady(true), 12_000);
    return () => clearTimeout(t);
  }, [asset, ready]);
  useEffect(() => {
    if (!ready) return;
    const t = setInterval(() => setI((x) => (x + 1) % SHOWREEL.length), 3600);
    return () => clearInterval(t);
  }, [ready]);

  return (
    <div className="relative size-full">
      {!ready && (
        <div className="absolute inset-0 grid place-items-center" aria-hidden>
          <span className="size-7 animate-spin rounded-full border-2 border-white/10 border-t-white/60" />
        </div>
      )}
      <motion.div className="size-full" initial={{ opacity: 0 }} animate={{ opacity: ready ? 1 : 0 }} transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}>
      <AvatarCanvas
        camera={{ fov: 24, near: 0.02, far: 30, position: compact ? [0.4, 0.13, 0.98] : [0.42, 0.06, 0.92] }}
        aria-label="Live 3D twin demo — drag to rotate"
      >
        <StudioStage />
        <OrbitControls
          makeDefault
          target={compact ? [0, -0.045, 0.01] : [0, -0.02, 0.01]}
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.7}
          enableDamping
          minPolarAngle={1.1}
          maxPolarAngle={1.9}
        />
        {asset && <Avatar asset={asset} look={SHOWREEL[i].look} quality={quality} channel="hero" onBusy={(busy) => !busy && setReady(true)} />}
      </AvatarCanvas>
      </motion.div>
      <div className="pointer-events-none absolute bottom-[12%] left-1/2 hidden -translate-x-1/2 md:block">
        <AnimatePresence mode="wait">
          {ready && (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.4 }}
              className="glass flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[12px] text-mist-200"
            >
              <span className="size-1.5 animate-pulse rounded-full bg-ok-400" />
              Live 3D · {SHOWREEL[i].label}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
