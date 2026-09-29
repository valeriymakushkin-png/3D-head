"use client";

import { motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { PREVIEW_VIEWS, previewTargets } from "@/lib/engine/previews";
import { bumpScene } from "@/lib/engine/sceneBus";
import { cn } from "@/lib/cn";
import { useStudio } from "@/store/studio";

/** Four live orthogonal views, re-rendered whenever the twin changes. */
export function PreviewRail({ className }: { className?: string }) {
  const view = useStudio((s) => s.view);
  const flyTo = useStudio((s) => s.flyTo);
  return (
    <div className={cn("flex flex-col gap-2.5", className)}>
      {PREVIEW_VIEWS.map((v, i) => (
        <motion.button
          key={v.id}
          initial={{ opacity: 0, x: 16 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.25 + i * 0.06, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          onClick={() => flyTo(v.id)}
          className={cn(
            "group relative overflow-hidden rounded-2xl transition-[box-shadow,transform] duration-300 hover:scale-[1.03]",
            "glass-soft h-[74px] w-[60px] md:h-[104px] md:w-[84px]",
            view.id === v.id && view.nonce > 0 && "ring-1 ring-mist-100/70",
          )}
          aria-label={`${v.label} view`}
        >
          <PreviewCanvas id={v.id} />
          <span className="pointer-events-none absolute inset-x-0 bottom-1 text-center text-[10px] font-medium tracking-wide text-mist-300 md:text-[11px]">
            {v.label}
          </span>
        </motion.button>
      ))}
    </div>
  );
}

function PreviewCanvas({ id }: { id: (typeof PREVIEW_VIEWS)[number]["id"] }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    previewTargets.set(id, c);
    // Repaint once the environment map and hair have settled.
    const timers = [400, 1400].map((ms) => setTimeout(bumpScene, ms));
    return () => {
      timers.forEach(clearTimeout);
      if (previewTargets.get(id) === c) previewTargets.delete(id);
    };
  }, [id]);
  return <canvas ref={ref} className="absolute inset-0 size-full bg-[radial-gradient(80%_70%_at_50%_40%,#1b1c21,#0b0b0d)]" />;
}
