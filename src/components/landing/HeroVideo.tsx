"use client";

import { useEffect, useRef } from "react";

/**
 * The landing hero: a path-traced render of a TwinMe twin (Blender Cycles,
 * scripts/cycles/render_twin.py) as a short seamless loop. A video is a few
 * hundred KB of work for the phone instead of a live WebGL scene, and it
 * shows the twin at offline quality.
 *
 * iOS only autoplays inline, muted video, and React renders `muted` as a
 * property after hydration — so we (re)assert it and start playback here;
 * in Low Power Mode the poster frame stays.
 */
export function HeroVideo({ className }: { className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.playsInline = true;
    const start = () => v.play().catch(() => undefined);
    start();
    const onVis = () => document.visibilityState === "visible" && start();
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);
  return (
    <video
      ref={ref}
      className={className}
      poster="/hero/twin-poster.jpg"
      autoPlay
      muted
      loop
      playsInline
      preload="auto"
      disablePictureInPicture
      aria-label="A TwinMe 3D twin, turning slowly"
    >
      <source src="/hero/twin.webm" type="video/webm" />
      <source src="/hero/twin.mp4" type="video/mp4" />
    </video>
  );
}
