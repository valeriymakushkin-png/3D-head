"use client";

import dynamic from "next/dynamic";

/** Three.js never runs on the server; the hero streams in after first paint. */
export const HeroTwinLazy = dynamic(() => import("./HeroTwin").then((m) => m.HeroTwin), {
  ssr: false,
  loading: () => (
    <div className="grid size-full place-items-center">
      <div className="size-[46%] animate-breathe rounded-full bg-[radial-gradient(closest-side,rgba(246,246,248,0.07),transparent)]" />
    </div>
  ),
});
