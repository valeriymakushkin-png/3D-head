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
  { label: "Quiff · Stubble", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "quiff", color: "dark_brown" }, beard: { style: "stubble" } }) },
  { label: "Textured Crop · Short beard", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "textured_crop", color: "brown" }, beard: { style: "short" }, glasses: { style: "rectangle" } }) },
  { label: "Pompadour · Full beard", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "pompadour", color: "black" }, beard: { style: "full" } }) },
  { label: "Buzz Cut · Aviators", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "buzz_cut", color: "dark_brown" }, beard: { style: "stubble" }, glasses: { style: "aviator" } }) },
  { label: "Curtains · Round frames", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "curtains", color: "brown" }, glasses: { style: "round" } }) },
  { label: "Undercut · Platinum", look: applyLookPatch(DEFAULT_LOOK, { hair: { style: "undercut", color: "platinum" }, beard: { style: "clean" } }) },
];

/** Live, real-time 3D showreel — not a video. Drag to rotate. */
export function HeroTwin() {
  const [asset, setAsset] = useState<HeadAsset | null>(null);
  const [i, setI] = useState(0);
  const [quality] = useState<QualityTier>(() => (typeof window === "undefined" ? "medium" : detectQuality() === "high" ? "medium" : "low"));
  useEffect(() => {
    loadTemplateHead().then(setAsset).catch(console.error);
  }, []);
  useEffect(() => {
    if (!asset) return;
    const t = setInterval(() => setI((x) => (x + 1) % SHOWREEL.length), 3600);
    return () => clearInterval(t);
  }, [asset]);

  return (
    <div className="relative size-full">
      <AvatarCanvas camera={{ fov: 24, near: 0.02, far: 30, position: [0.42, 0.02, 0.92] }} aria-label="Live 3D twin demo — drag to rotate">
        <StudioStage />
        <OrbitControls
          makeDefault
          target={[0, -0.02, 0.01]}
          enableZoom={false}
          enablePan={false}
          autoRotate
          autoRotateSpeed={0.7}
          enableDamping
          minPolarAngle={1.1}
          maxPolarAngle={1.9}
        />
        {asset && <Avatar asset={asset} look={SHOWREEL[i].look} quality={quality} channel="hero" />}
      </AvatarCanvas>
      <div className="pointer-events-none absolute bottom-[12%] left-1/2 -translate-x-1/2">
        <AnimatePresence mode="wait">
          {asset && (
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
