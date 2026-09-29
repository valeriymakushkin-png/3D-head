"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { IconExport, IconRedo, IconSparkle, IconUndo, IconWand } from "@/components/ui/icons";
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
          <Link href="/create" className="glass-soft hidden items-center gap-2 rounded-full py-1.5 pl-1.5 pr-3 text-[12px] text-mist-300 hover:text-mist-100 lg:flex">
            <span className="size-5 rounded-full bg-[radial-gradient(circle_at_35%_30%,#d8b69b,#6b4c3b)]" />
            {asset.kind === "template" ? "Demo twin · scan yours" : asset.kind === "hd" ? "HD twin" : "Instant twin"}
          </Link>
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
