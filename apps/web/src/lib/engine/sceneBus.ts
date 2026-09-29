"use client";

import { create } from "zustand";

/**
 * Bumped whenever something visible on the avatar changes (new hair
 * geometry, material uniforms, glasses). Offscreen renderers — the four live
 * previews and the carousel thumbnails — re-render only on a bump instead of
 * every frame.
 */
export const useSceneVersion = create<{ version: number; bump: () => void }>((set) => ({
  version: 0,
  bump: () => set((s) => ({ version: s.version + 1 })),
}));

export const bumpScene = () => useSceneVersion.getState().bump();
