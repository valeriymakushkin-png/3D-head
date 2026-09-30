"use client";

import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useAccount } from "@/lib/account";
import { label } from "@/lib/style/engine";
import { type HeadAsset, loadHdHead, loadInstantHead, loadTemplateHead } from "@/lib/head/asset";
import type { HeadRig } from "@/lib/head/rig";
import { fetchCloudAvatar } from "@/lib/recon/hd";
import type { FaceAnalysis } from "@/lib/style/analysis";
import { avatarVault, getActiveAvatarId, setActiveAvatarId } from "@/lib/recon/storage";
import { cn } from "@/lib/cn";
import { CompareHandle, GlowUpOverlay, useGlowUp } from "@/components/studio/GlowUp";
import { PreviewRail } from "@/components/studio/PreviewRail";
import { ExportSheet, Paywall } from "@/components/studio/Sheets";
import { TwinsSheet } from "@/components/studio/TwinsSheet";
import { StudioScene } from "@/components/studio/StudioScene";
import { StyleDock } from "@/components/studio/StyleDock";
import { StylistPanel } from "@/components/studio/StylistPanel";
import { TopBar } from "@/components/studio/TopBar";
import { IconCamera, IconCompare, IconOrbit, IconReset } from "@/components/ui/icons";
import { easeOut } from "@/components/ui/primitives";
import { detectQuality, restoreLook, useStudio } from "@/store/studio";
import { DEFAULT_LOOK } from "@/lib/avatar/look";

/** Loads the active twin: ?avatar=<id> → last used → demo template. */
async function loadActiveAsset(requested: string | null, demo: boolean): Promise<HeadAsset> {
  if (!demo) {
    const id = requested ?? getActiveAvatarId();
    if (id) {
      const rec = await avatarVault.get(id).catch(() => undefined);
      if (rec) {
        setActiveAvatarId(rec.id);
        return loadInstantHead(rec);
      }
      // Not on this device: a cloud HD twin?
      const cloud = await fetchCloudAvatar(id).catch(() => null);
      if (cloud?.status === "ready" && cloud.model_url && cloud.rig && cloud.analysis && cloud.natural_hair) {
        return loadHdHead({
          id: cloud.id,
          model_url: cloud.model_url,
          rig: cloud.rig as HeadRig,
          analysis: cloud.analysis as FaceAnalysis,
          natural_hair: cloud.natural_hair as unknown as Parameters<typeof loadHdHead>[0]["natural_hair"],
        });
      }
    }
  }
  return loadTemplateHead();
}

/** Inside the Telegram Mini App every navigation must stay under /tg (Telegram Web frames only /tg). */
function createHref() {
  return typeof window !== "undefined" && window.location.pathname.startsWith("/tg") ? "/tg?create=1" : "/create";
}

export function StudioApp({ embedded = false }: { embedded?: boolean }) {
  const asset = useStudio((s) => s.asset);
  const assetError = useStudio((s) => s.assetError);
  const glow = useGlowUp();
  const panel = useStudio((s) => s.panel);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    useStudio.getState().setQuality(detectQuality());
    useAccount.getState().refresh();
    const q = new URLSearchParams(window.location.search);
    if (q.get("upgrade")) useStudio.getState().openPanel("paywall");
    loadActiveAsset(q.get("avatar"), q.get("demo") === "1")
      .then((a) => {
        const s = useStudio.getState();
        s.setAsset(a);
        // Each twin starts from its own saved look (or its natural one), never the previous twin's.
        useStudio.setState({ look: restoreLook(a.id) ?? DEFAULT_LOOK, past: [], future: [] });
      })
      .catch((e) => useStudio.getState().setAsset(null, String(e)));
    const mq = window.matchMedia("(max-width: 767px)");
    const onMq = () => setCompact(mq.matches);
    onMq();
    mq.addEventListener("change", onMq);
    return () => mq.removeEventListener("change", onMq);
  }, []);

  // Keyboard: ⌘K stylist · ⌘Z/⇧⌘Z history · 1–4 views · space turntable · G glow up
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest("input, textarea, [contenteditable]")) return;
      const s = useStudio.getState();
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        s.openPanel(s.panel === "stylist" ? "none" : "stylist");
      } else if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.redo();
        else s.undo();
      } else if (e.key === "Escape") s.openPanel("none");
      else if (["1", "2", "3", "4"].includes(e.key)) s.flyTo((["front", "left", "right", "back"] as const)[+e.key - 1]);
      else if (e.key === " ") {
        e.preventDefault();
        s.setTurntable(!s.turntable);
      } else if (e.key.toLowerCase() === "g") glow.start();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [glow]);

  return (
    <main className="fixed inset-0 overflow-hidden bg-ink-950 text-mist-100">
      <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_42%,#221f1b_0%,#0e0d0b_55%,#0b0a09_100%)]" />
      <div className="absolute inset-x-0 top-[8%] mx-auto h-[70%] w-[60%] animate-breathe rounded-full bg-[radial-gradient(closest-side,rgba(159,173,255,0.07),transparent)] blur-2xl" />
      <StudioScene />
      <div className="stage-vignette absolute inset-0" />
      <div className="grain absolute inset-0" />

      {!asset && !assetError && <Loader />}
      {assetError && (
        <div className="absolute inset-0 grid place-items-center p-6 text-center">
          <div>
            <p className="text-mist-200">We couldn&apos;t open your twin.</p>
            <p className="mt-1 text-[13px] text-mist-500">{assetError}</p>
            <Link href={createHref()} className="mt-4 inline-block text-iris-300">
              Scan again
            </Link>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0">
        <TopBar onGlowUp={glow.start} hideBrand={embedded} />
        <ToolRail />
        <div className={cn("pointer-events-auto absolute right-3 top-1/2 z-20 -translate-y-1/2 transition-opacity duration-300 md:right-6", panel === "stylist" && "pointer-events-none opacity-0")}>
          <PreviewRail />
        </div>
        <AppliedToast />
        <CompareHandle />
        {glow.phase !== "result" && (
          <div className="absolute inset-x-0 bottom-0 z-20 mx-auto flex max-w-[1080px] px-2 pb-[calc(var(--tg-safe-bottom)+8px)] md:px-6 md:pb-6">
            <StyleDock compact={compact} />
          </div>
        )}
        <GlowUpOverlay state={glow} />
        <StylistPanel />
        <ExportSheet />
        <TwinsSheet />
        <Paywall />
      </div>
    </main>
  );
}

function ToolRail() {
  const turntable = useStudio((s) => s.turntable);
  const setTurntable = useStudio((s) => s.setTurntable);
  const flyTo = useStudio((s) => s.flyTo);
  const asset = useStudio((s) => s.asset);
  const compare = useStudio((s) => s.compare);
  const startCompare = useStudio((s) => s.startCompare);
  const look = useStudio((s) => s.look);
  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.3, duration: 0.6, ease: easeOut }}
      className="pointer-events-auto absolute left-3 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-1.5 md:left-6 md:flex"
    >
      <RailButton active={turntable} onClick={() => setTurntable(!turntable)} label="Turntable (space)">
        <IconOrbit size={18} />
      </RailButton>
      <RailButton onClick={() => flyTo("three_quarter")} label="Reset view">
        <IconReset size={18} />
      </RailButton>
      <RailButton
        active={!!compare}
        onClick={() => {
          if (compare) useStudio.setState({ compare: null });
          else if (asset) startCompare({ ...look, hair: { ...look.hair, style: "natural", color: "natural", customColor: null, length: null, volume: null, texture: null }, beard: { style: asset.analysis.beard.detected, length: null }, glasses: { style: "none", tint: null }, skin: { tone: "natural", complexion: 0 }, accessories: [] }, look);
        }}
        label="Compare with the real you"
      >
        <IconCompare size={18} />
      </RailButton>
      <Link href={createHref()} className="glass mt-2 grid size-11 place-items-center rounded-full text-mist-300 hover:text-mist-50" aria-label="New scan" title="New scan">
        <IconCamera size={18} />
      </Link>
    </motion.div>
  );
}

function RailButton({ children, active, onClick, label: l }: { children: React.ReactNode; active?: boolean; onClick: () => void; label: string }) {
  return (
    <button onClick={onClick} title={l} aria-label={l} aria-pressed={active} className={cn("glass grid size-11 place-items-center rounded-full transition-colors", active ? "text-mist-50 ring-1 ring-mist-100/40" : "text-mist-400 hover:text-mist-100")}>
      {children}
    </button>
  );
}

function AppliedToast() {
  const change = useStudio((s) => s.lastChange);
  const look = useStudio((s) => s.look);
  const undo = useStudio((s) => s.undo);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!change || change.source === "restore" || change.source === "manual") return;
    setVisible(true);
    const t = setTimeout(() => setVisible(false), 3800);
    return () => clearTimeout(t);
  }, [change]);
  const text = change ? change.dims.map((d) => (d === "hair" ? label(look.hair.style) : d === "beard" ? label(look.beard.style) : d === "glasses" ? (look.glasses.style === "none" ? "No glasses" : label(look.glasses.style)) : d === "skin" ? "Skin" : "Accessories")).join(" · ") : "";
  return (
    <AnimatePresence>
      {visible && text && (
        <motion.div
          initial={{ opacity: 0, y: -8, scale: 0.96 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6 }}
          className="glass pointer-events-auto absolute left-1/2 top-[74px] z-30 flex -translate-x-1/2 items-center gap-3 rounded-full py-1.5 pl-4 pr-1.5 md:top-[84px]"
        >
          <span className="text-[13px] text-mist-200">
            <span className="text-iris-300">Applied</span> · {text}
          </span>
          <button onClick={undo} className="rounded-full bg-white/[0.07] px-3 py-1 text-[12px] text-mist-200 hover:bg-white/[0.12]">
            Undo
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Loader() {
  return (
    <div className="absolute inset-0 grid place-items-center">
      <div className="flex flex-col items-center gap-3">
        <div className="size-10 animate-spin rounded-full border border-white/10 border-t-mist-200" />
        <p className="text-shimmer text-[13px]">Waking up your twin</p>
      </div>
    </div>
  );
}
