"use client";

import { create } from "zustand";
import { DEFAULT_LOOK, type Look, type LookPatch, applyLookPatch, diffLooks, looksEqual } from "@/lib/avatar/look";
import type { QualityTier } from "@/lib/engine/protocol";
import type { HeadAsset } from "@/lib/head/asset";

export const CATEGORIES = ["hair", "beard", "color", "glasses", "skin", "accessories"] as const;
export type Category = (typeof CATEGORIES)[number];

export type LookSource = "manual" | "stylist" | "glow_up" | "restore";
export type Panel = "none" | "stylist" | "glowup" | "export" | "account" | "paywall" | "twins";
export type ViewId = "front" | "left" | "right" | "back" | "three_quarter";

interface CompareState {
  before: Look;
  after: Look;
  split: number;
}

interface StudioState {
  asset: HeadAsset | null;
  assetError: string | null;
  look: Look;
  past: Look[];
  future: Look[];
  category: Category;
  quality: QualityTier;
  busy: boolean;
  panel: Panel;
  compare: CompareState | null;
  lastChange: { source: LookSource; dims: string[]; at: number } | null;
  /** Camera fly-to request (consumed by the camera rig). */
  view: { id: ViewId; nonce: number };
  turntable: boolean;

  setAsset: (a: HeadAsset | null, error?: string | null) => void;
  applyPatch: (patch: LookPatch, source?: LookSource) => void;
  /** Live update while dragging a slider — no history entry until `commitDrag`. */
  dragPatch: (patch: LookPatch) => void;
  commitDrag: () => void;
  dragBase: Look | null;
  setLook: (look: Look, source?: LookSource) => void;
  undo: () => void;
  redo: () => void;
  setCategory: (c: Category) => void;
  setQuality: (q: QualityTier) => void;
  setBusy: (b: boolean) => void;
  openPanel: (p: Panel) => void;
  startCompare: (before: Look, after: Look) => void;
  setSplit: (s: number) => void;
  endCompare: (keep: "before" | "after") => void;
  flyTo: (id: ViewId) => void;
  setTurntable: (on: boolean) => void;
}

const HISTORY = 50;

export const useStudio = create<StudioState>((set, get) => ({
  asset: null,
  assetError: null,
  look: DEFAULT_LOOK,
  past: [],
  future: [],
  category: "hair",
  quality: "high",
  busy: false,
  panel: "none",
  compare: null,
  lastChange: null,
  view: { id: "three_quarter", nonce: 0 },
  turntable: false,

  setAsset: (asset, error = null) => set({ asset, assetError: error }),
  applyPatch: (patch, source = "manual") => get().setLook(applyLookPatch(get().look, patch), source),
  dragBase: null,
  dragPatch: (patch) => {
    const { look, dragBase } = get();
    set({ look: applyLookPatch(look, patch), dragBase: dragBase ?? look });
  },
  commitDrag: () => {
    const { dragBase, look, past } = get();
    if (!dragBase) return;
    set({
      dragBase: null,
      past: looksEqual(dragBase, look) ? past : [...past, dragBase].slice(-HISTORY),
      future: [],
      lastChange: { source: "manual", dims: diffLooks(dragBase, look), at: Date.now() },
    });
    persistLook(get().asset?.id, look);
  },
  setLook: (look, source = "manual") => {
    const prev = get().look;
    if (looksEqual(prev, look)) return;
    set({
      look,
      past: [...get().past, prev].slice(-HISTORY),
      future: [],
      lastChange: { source, dims: diffLooks(prev, look), at: Date.now() },
    });
    persistLook(get().asset?.id, look);
  },
  undo: () => {
    const { past, look, future } = get();
    const prev = past.at(-1);
    if (!prev) return;
    set({ look: prev, past: past.slice(0, -1), future: [look, ...future], lastChange: { source: "restore", dims: diffLooks(look, prev), at: Date.now() } });
  },
  redo: () => {
    const { past, look, future } = get();
    const next = future[0];
    if (!next) return;
    set({ look: next, past: [...past, look], future: future.slice(1), lastChange: { source: "restore", dims: diffLooks(look, next), at: Date.now() } });
  },
  setCategory: (category) => set({ category }),
  setQuality: (quality) => set({ quality }),
  setBusy: (busy) => set({ busy }),
  openPanel: (panel) => set({ panel }),
  startCompare: (before, after) => set({ compare: { before, after, split: 0.5 } }),
  setSplit: (split) => {
    const c = get().compare;
    if (c) set({ compare: { ...c, split: Math.min(0.95, Math.max(0.05, split)) } });
  },
  endCompare: (keep) => {
    const c = get().compare;
    if (!c) return;
    set({ compare: null });
    get().setLook(keep === "after" ? c.after : c.before, "glow_up");
  },
  flyTo: (id) => set({ view: { id, nonce: get().view.nonce + 1 } }),
  setTurntable: (turntable) => set({ turntable }),
}));

const LOOK_KEY = (id: string) => `twinme.look.${id}`;

function persistLook(assetId: string | undefined, look: Look) {
  if (!assetId) return;
  try {
    localStorage.setItem(LOOK_KEY(assetId), JSON.stringify(look));
  } catch {
    /* storage unavailable */
  }
}

export function restoreLook(assetId: string): Look | null {
  try {
    const raw = localStorage.getItem(LOOK_KEY(assetId));
    return raw ? (JSON.parse(raw) as Look) : null;
  } catch {
    return null;
  }
}

/** Picks a rendering budget from the device. */
export function detectQuality(): QualityTier {
  if (typeof navigator === "undefined") return "high";
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 8;
  const cores = navigator.hardwareConcurrency ?? 8;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (mobile) return mem >= 6 && cores >= 8 ? "medium" : "low";
  if (mem >= 8 && cores >= 8) return "high";
  return "medium";
}
