"use client";

import { motion } from "framer-motion";
import { forwardRef, useCallback, useRef } from "react";
import { cn } from "@/lib/cn";

export const spring = { type: "spring", stiffness: 420, damping: 36, mass: 0.8 } as const;
export const easeOut = [0.16, 1, 0.3, 1] as const;

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "glass" | "solid" | "ghost" | "ai";
  size?: "sm" | "md" | "lg" | "icon";
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "glass", size = "md", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={cn(
        "inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium tracking-[-0.01em] transition-[transform,background,color,opacity] duration-200 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-iris-400/60",
        variant === "glass" && "glass text-mist-100 hover:bg-white/[0.07]",
        variant === "solid" && "bg-mist-50 text-ink-950 shadow-[0_10px_40px_-12px_rgba(255,255,255,0.45)] hover:bg-white",
        variant === "ghost" && "text-mist-300 hover:bg-white/[0.06] hover:text-mist-50",
        variant === "ai" && "glass ai-ring text-mist-50 hover:bg-white/[0.08]",
        size === "sm" && "h-8 px-3.5 text-[13px]",
        size === "md" && "h-10 px-4.5 text-sm",
        size === "lg" && "h-13 px-7 text-[15px]",
        size === "icon" && "size-10",
        className,
      )}
      {...props}
    />
  );
});

/** Pill slider with a numeric readout (reference: 0.0 – 1.0). */
export function Slider({
  label,
  value,
  onChange,
  onCommit,
  className,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  onCommit?: (v: number) => void;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const toValue = useCallback((clientX: number) => {
    const r = track.current!.getBoundingClientRect();
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  }, []);
  const pct = `${(value * 100).toFixed(1)}%`;
  return (
    <div className={cn("flex items-center gap-4", className)}>
      <span className="w-[74px] shrink-0 text-[13px] text-mist-300">{label}</span>
      <div
        ref={track}
        role="slider"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={+value.toFixed(2)}
        tabIndex={0}
        className="relative h-7 flex-1 cursor-pointer touch-none"
        onPointerDown={(e) => {
          (e.target as HTMLElement).setPointerCapture(e.pointerId);
          onChange(toValue(e.clientX));
        }}
        onPointerMove={(e) => {
          if (e.buttons) onChange(toValue(e.clientX));
        }}
        onPointerUp={(e) => onCommit?.(toValue(e.clientX))}
        onKeyDown={(e) => {
          const step = e.shiftKey ? 0.1 : 0.02;
          if (e.key === "ArrowRight") onCommit?.(Math.min(1, value + step));
          if (e.key === "ArrowLeft") onCommit?.(Math.max(0, value - step));
        }}
      >
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/10" />
        <div className="absolute left-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-mist-100/80" style={{ width: pct }} />
        <motion.div
          className="absolute top-1/2 size-4 -translate-x-1/2 -translate-y-1/2 rounded-full bg-mist-50 shadow-[0_2px_10px_rgba(0,0,0,0.5)]"
          style={{ left: pct }}
          whileTap={{ scale: 1.25 }}
        />
      </div>
      <span className="w-9 text-right text-[13px] tabular-nums text-mist-400">{value.toFixed(1)}</span>
    </div>
  );
}

export function Kbd({ children }: { children: React.ReactNode }) {
  return <kbd className="rounded-md border border-white/10 bg-white/5 px-1.5 py-0.5 font-sans text-[10px] text-mist-400">{children}</kbd>;
}
