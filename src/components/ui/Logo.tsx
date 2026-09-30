import { cn } from "@/lib/cn";

/**
 * Two offset profiles that resolve into one — the twin. No gradient ids:
 * several instances render at once (responsive variants) and a hidden
 * instance's <defs> would break the visible one's url(#id) references.
 */
export function LogoMark({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" className={cn("text-mist-50", className)} aria-hidden>
      <circle cx="13" cy="16" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.95" />
      <circle cx="19" cy="16" r="9.5" fill="none" stroke="currentColor" strokeWidth="1.6" opacity="0.45" />
      <path d="M16 7.6a9.5 9.5 0 0 1 0 16.8 9.5 9.5 0 0 1 0-16.8z" fill="currentColor" opacity="0.85" />
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <LogoMark size={24} />
      <span className="font-display text-[19px] font-semibold tracking-[-0.01em] text-mist-50">TwinMe</span>
    </span>
  );
}
