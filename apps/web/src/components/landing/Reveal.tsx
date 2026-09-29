"use client";

import { useEffect, useRef } from "react";

/**
 * Scroll reveal that is visible by default (SSR, no-JS, crawlers, slow
 * devices) and only animates once hydrated and actually below the fold.
 */
export function Reveal({ children, delay = 0, className }: { children: React.ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (el.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    el.classList.add("reveal-armed");
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          el.classList.add("reveal-in");
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={className} style={{ transitionDelay: `${delay}s` }}>
      {children}
    </div>
  );
}
