"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useRef, useState } from "react";
import { fetchGlowUpNarrative, meterTransformation } from "@/lib/api/client";
import { type GlowUpResult, glowUp } from "@/lib/style/engine";
import { IconCheck, IconWand } from "@/components/ui/icons";
import { Button, easeOut } from "@/components/ui/primitives";
import { useStudio } from "@/store/studio";

type Phase = "idle" | "analyzing" | "result";

/**
 * One click → the deterministic style engine picks the best look for this
 * face, the studio enters a live 3D before/after split, and (when available)
 * the LLM rewrites the rationale in natural language.
 */
export function useGlowUp() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [result, setResult] = useState<GlowUpResult | null>(null);
  const [step, setStep] = useState(0);
  const abort = useRef<AbortController | null>(null);

  const start = useCallback(async () => {
    const { asset, look, startCompare, openPanel } = useStudio.getState();
    if (!asset || phase !== "idle") return;
    const metered = await meterTransformation({ type: "glow_up", avatarId: asset.kind === "template" ? null : asset.id, settings: {} });
    if (!metered.ok && metered.code === "quota_exceeded") {
      openPanel("paywall");
      return;
    }
    setPhase("analyzing");
    setStep(0);
    const r = glowUp(look, { analysis: asset.analysis, goal: "balanced" });
    setResult(r);
    abort.current = new AbortController();
    fetchGlowUpNarrative({ analysis: asset.analysis, before: look, after: r.look, patch: r.patch }, abort.current.signal)
      .then((n) => n && setResult((cur) => (cur ? { ...cur, headline: n.headline, rationale: n.rationale } : cur)))
      .catch(() => undefined);
    for (let i = 1; i <= 3; i++) {
      await new Promise((res) => setTimeout(res, 620));
      setStep(i);
    }
    startCompare(look, r.look);
    setPhase("result");
  }, [phase]);

  const finish = useCallback((keep: "before" | "after") => {
    abort.current?.abort();
    useStudio.getState().endCompare(keep);
    setPhase("idle");
    setResult(null);
  }, []);

  return { phase, result, step, start, finish };
}

export function GlowUpOverlay({ state }: { state: ReturnType<typeof useGlowUp> }) {
  const asset = useStudio((s) => s.asset);
  const { phase, result, step, finish } = state;
  const a = asset?.analysis;
  const steps = a
    ? [
        `Face shape · ${a.faceShape} (${Math.round((a.faceShapeScores[a.faceShape] ?? 0) * 100)}%)`,
        `Proportions · ${a.metrics.lengthToWidth.toFixed(2)} length-to-width`,
        `Skin · ${a.skin.category.replace("_", " ")}, ${a.skin.undertone} undertone`,
      ]
    : [];

  return (
    <>
      <AnimatePresence>
        {phase === "analyzing" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-0 z-40 grid place-items-center bg-[radial-gradient(60%_50%_at_50%_45%,transparent,rgba(5,5,6,0.65))]"
          >
            <div className="flex flex-col items-center gap-4">
              <motion.div animate={{ rotate: 360 }} transition={{ duration: 6, repeat: Infinity, ease: "linear" }} className="ai-ring grid size-14 place-items-center rounded-full">
                <IconWand size={22} className="text-aura-300" />
              </motion.div>
              <div className="flex flex-col items-center gap-1.5">
                {steps.map((s, i) => (
                  <motion.p
                    key={s}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: step >= i ? 1 : 0.25, y: 0 }}
                    transition={{ duration: 0.4, ease: easeOut }}
                    className={step === i ? "text-shimmer text-[15px] font-medium" : "text-[15px] text-mist-300"}
                  >
                    {s}
                  </motion.p>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {phase === "result" && result && (
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ duration: 0.55, ease: easeOut }}
            className="glass pointer-events-auto absolute inset-x-3 bottom-3 z-40 mx-auto max-w-[560px] rounded-[28px] p-5 md:bottom-6 md:p-6"
          >
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-aura-300">Your best version</p>
            <h3 className="mt-1.5 font-display text-[20px] font-semibold leading-tight tracking-[-0.02em] text-mist-50 md:text-[22px]">{result.headline.replace(/^Your best version:\s*/, "")}</h3>
            <ul className="mt-3 space-y-1.5">
              {result.rationale.slice(0, 4).map((r) => (
                <li key={r} className="flex gap-2 text-[13px] leading-5 text-mist-300">
                  <IconCheck size={15} className="mt-0.5 shrink-0 text-ok-400" />
                  {r}
                </li>
              ))}
            </ul>
            <div className="mt-5 flex gap-2">
              <Button variant="solid" className="h-11 flex-1" onClick={() => finish("after")}>
                Keep this look
              </Button>
              <Button variant="glass" className="h-11 flex-1" onClick={() => finish("before")}>
                Back to mine
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Draggable divider for the live 3D before/after split. */
export function CompareHandle() {
  const compare = useStudio((s) => s.compare);
  const setSplit = useStudio((s) => s.setSplit);
  if (!compare) return null;
  return (
    <div className="pointer-events-none absolute inset-0 z-30">
      <div className="absolute inset-y-0 w-px bg-mist-50/70 shadow-[0_0_24px_rgba(255,255,255,0.35)]" style={{ left: `${compare.split * 100}%` }} />
      <div
        data-compare-knob
        role="slider"
        aria-label="Before / after"
        aria-valuenow={Math.round(compare.split * 100)}
        tabIndex={0}
        onPointerDown={(e) => (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)}
        onPointerMove={(e) => {
          if (e.buttons & 1) setSplit(e.clientX / window.innerWidth);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setSplit(compare.split - 0.03);
          if (e.key === "ArrowRight") setSplit(compare.split + 0.03);
        }}
        className="glass pointer-events-auto absolute top-1/2 grid size-11 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize touch-none place-items-center rounded-full"
        style={{ left: `${compare.split * 100}%` }}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden>
          <path d="m9 7-5 5 5 5M15 7l5 5-5 5" />
        </svg>
      </div>
      <span className="absolute left-5 top-1/2 -translate-y-1/2 text-[11px] font-medium uppercase tracking-[0.16em] text-mist-300 md:left-8">Before</span>
      <span className="absolute right-[92px] top-1/2 -translate-y-1/2 text-[11px] font-medium uppercase tracking-[0.16em] text-aura-300 md:right-36">After</span>
    </div>
  );
}
