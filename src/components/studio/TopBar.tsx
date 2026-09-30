"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";
import { avatarVault } from "@/lib/recon/storage";
import { TwinAvatar } from "@/components/studio/TwinsSheet";
import Link from "next/link";
import { IconChevron, IconExport, IconRedo, IconSparkle, IconUndo, IconWand } from "@/components/ui/icons";
import { Wordmark, LogoMark } from "@/components/ui/Logo";
import { Button, Kbd, easeOut } from "@/components/ui/primitives";
import { useStudio } from "@/store/studio";

export function TopBar({ onGlowUp, hideBrand = false }: { onGlowUp: () => void; hideBrand?: boolean }) {
  const openPanel = useStudio((s) => s.openPanel);
  const undo = useStudio((s) => s.undo);
  const redo = useStudio((s) => s.redo);
  const canUndo = useStudio((s) => s.past.length > 0);
  const canRedo = useStudio((s) => s.future.length > 0);
  const asset = useStudio((s) => s.asset);
  const compare = useStudio((s) => s.compare);
  // The current twin's face (saved at scan time) for the twins button.
  const [thumb, setThumb] = useState<{ url: string; atlas: boolean } | null>(null);
  useEffect(() => {
    if (!asset || asset.kind === "template") return setThumb(null);
    let url: string | null = null;
    avatarVault
      .get(asset.id)
      .then((r) => {
        if (r) setThumb({ url: (url = URL.createObjectURL(r.thumbnail ?? r.albedo)), atlas: !r.thumbnail });
      })
      .catch(() => undefined);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [asset]);

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: easeOut }}
      className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between gap-3 px-4 pt-[calc(var(--tg-safe-top)+14px)] md:px-6 md:pt-5"
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-3">
        {!hideBrand && (
          <Link href="/" className="shrink-0" aria-label="TwinMe home">
            <Wordmark className="hidden md:inline-flex" />
            <LogoMark className="md:hidden" />
          </Link>
        )}
        {asset && (
          <button
            onClick={() => openPanel("twins")}
            className="glass-soft flex items-center gap-2 rounded-full p-1 pr-2.5 text-[12px] text-mist-200 transition-colors hover:text-mist-50 lg:py-1.5 lg:pl-1.5 lg:pr-3"
            aria-label="Your twins: switch, scan someone new or delete"
          >
            <TwinAvatar url={thumb?.url} atlas={thumb?.atlas} className="size-7 lg:size-6" />
            <span className="hidden lg:inline">{asset.kind === "template" ? "Demo twin · scan yours" : asset.kind === "hd" ? "HD twin" : "My twin"}</span>
            <IconChevron size={14} className="rotate-90 text-mist-400" />
          </button>
        )}
      </div>

      <div className="pointer-events-auto absolute left-1/2 -translate-x-1/2">
        <Button variant="ai" size="md" onClick={() => openPanel("stylist")} className="h-10 pl-3.5 pr-3 md:h-11 md:pl-4 md:pr-3.5" aria-label="Open AI Stylist">
          <IconSparkle size={18} className="text-iris-300" />
          <span className="text-[14px]">AI Stylist</span>
          <span className="hidden md:inline">
            <Kbd>⌘K</Kbd>
          </span>
        </Button>
      </div>

      <div className="pointer-events-auto flex items-center gap-1.5">
        <div className="hidden items-center md:flex">
          <Button variant="ghost" size="icon" onClick={undo} disabled={!canUndo} aria-label="Undo">
            <IconUndo size={18} />
          </Button>
          <Button variant="ghost" size="icon" onClick={redo} disabled={!canRedo} aria-label="Redo">
            <IconRedo size={18} />
          </Button>
        </div>
        <Button variant="glass" onClick={onGlowUp} disabled={!!compare} className="h-10 px-3 md:h-11 md:px-4" aria-label="Show me my best version">
          <IconWand size={18} className="text-aura-300" />
          <span className="hidden text-[14px] sm:inline">Best version</span>
        </Button>
        <Button variant="glass" size="icon" onClick={() => openPanel("export")} className="hidden size-11 md:inline-flex" aria-label="Export">
          <IconExport size={18} />
        </Button>
      </div>
    </motion.header>
  );
}
