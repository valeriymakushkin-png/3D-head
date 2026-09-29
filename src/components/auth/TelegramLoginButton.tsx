"use client";

import { useEffect, useRef } from "react";

/** Official Telegram Login Widget; Telegram redirects to our verified callback. */
export function TelegramLoginButton({ bot, next }: { bot: string; next: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const s = document.createElement("script");
    s.src = "https://telegram.org/js/telegram-widget.js?22";
    s.async = true;
    s.setAttribute("data-telegram-login", bot);
    s.setAttribute("data-size", "large");
    s.setAttribute("data-radius", "20");
    s.setAttribute("data-request-access", "write");
    s.setAttribute("data-auth-url", `${window.location.origin}/api/auth/telegram-login?next=${encodeURIComponent(next)}`);
    el.appendChild(s);
    return () => {
      el.innerHTML = "";
    };
  }, [bot, next]);
  return <div ref={ref} className="min-h-[44px]" />;
}
