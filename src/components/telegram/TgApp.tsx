"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useAccount } from "@/lib/account";
import { setBearer } from "@/lib/api/fetch";
import { getActiveAvatarId } from "@/lib/recon/storage";
import { type TelegramWebApp } from "@/lib/telegram/webapp";
import { CreateFlow } from "@/components/capture/CreateFlow";
import { StudioApp } from "@/components/studio/StudioApp";
import { IconTelegram } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/Logo";

type Mode = "boot" | "create" | "studio";

const TG_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME;

/** Scan first when asked to, or when there is no twin to show (the demo counts as one). */
const wantsCreate = (q: URLSearchParams) => !!q.get("create") || !(q.get("avatar") || q.get("demo") || getActiveAvatarId());

/**
 * Telegram Mini App shell: native chrome integration (fullscreen, safe areas,
 * back button, haptics, no swipe-to-close while orbiting the head), initData
 * sign-in, then the same Create / Studio experience as the web.
 */
export function TgApp() {
  const q = useSearchParams();
  const [mode, setMode] = useState<Mode>("boot");
  const [tg, setTg] = useState<TelegramWebApp | null>(null);
  const [outside, setOutside] = useState(false);

  // 1) runtime + chrome
  useEffect(() => {
    // Telegram launches Mini Apps with #tgWebAppData=… in the URL, so we know we're inside
    // Telegram before its SDK script arrives — and wait for it on slow mobile networks.
    const launchedByTelegram = /tgWebApp(Data|Platform|Version)=/.test(window.location.hash + window.location.search);
    const maxTries = launchedByTelegram ? 300 : 40; // 15 s vs 2 s
    let tries = 0;
    const t = setInterval(() => {
      const w = window.Telegram?.WebApp;
      if ((w && (w.initData || !launchedByTelegram)) || ++tries > maxTries) {
        clearInterval(t);
        if (!w || !w.initData) {
          setOutside(true);
          setMode(wantsCreate(q) ? "create" : "studio");
          return;
        }
        w.ready();
        w.expand();
        w.disableVerticalSwipes?.();
        if (/android|ios/.test(w.platform) && w.isVersionAtLeast("8.0")) w.requestFullscreen?.();
        w.setHeaderColor("#0b0a09");
        w.setBackgroundColor("#0b0a09");
        w.setBottomBarColor?.("#0b0a09");
        const applyInsets = () => {
          const s = w.safeAreaInset ?? { top: 0, bottom: 0 };
          const c = w.contentSafeAreaInset ?? { top: 0, bottom: 0 };
          document.documentElement.style.setProperty("--tg-safe-top", `${s.top + c.top}px`);
          document.documentElement.style.setProperty("--tg-safe-bottom", `${s.bottom + c.bottom}px`);
        };
        applyInsets();
        ["safeAreaChanged", "contentSafeAreaChanged", "fullscreenChanged", "viewportChanged"].forEach((e) => w.onEvent(e, applyInsets));
        setTg(w);
      }
    }, 50);
    return () => clearInterval(t);
  }, [q]);

  // 2) sign-in with initData (once per launch; later URL changes only switch views)
  const signedIn = useRef(false);
  useEffect(() => {
    if (!tg || signedIn.current) return;
    signedIn.current = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/telegram", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ initData: tg.initData }),
        });
        if (res.ok) {
          const j = (await res.json()) as { token: string; startParam: string | null };
          setBearer(j.token);
          await useAccount.getState().refresh();
          if (j.startParam === "create") return setMode("create");
        }
      } catch (e) {
        console.warn("[tg] auth failed", e);
      }
      setMode(wantsCreate(q) ? "create" : "studio");
    })();
  }, [tg, q]);

  // 3) native back button in the capture flow
  useEffect(() => {
    if (!tg) return;
    const back = () => {
      if (getActiveAvatarId()) setMode("studio");
      else tg.close();
    };
    if (mode === "create") {
      tg.BackButton.show();
      tg.BackButton.onClick(back);
    } else tg.BackButton.hide();
    return () => tg.BackButton.offClick(back);
  }, [tg, mode]);

  // Created a twin → studio (CreateFlow navigates to /tg?avatar=…); "New scan" → /tg?create=1
  useEffect(() => {
    if ((q.get("avatar") || q.get("demo")) && mode === "create") setMode("studio");
    else if (q.get("create") && mode === "studio") setMode("create");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  if (mode === "boot") {
    return (
      <div className="fixed inset-0 grid place-items-center bg-ink-950">
        <div className="size-10 animate-spin rounded-full border border-white/10 border-t-mist-200" />
      </div>
    );
  }
  return (
    <>
      {outside && mode === "studio" && TG_BOT && (
        <a
          href={`https://t.me/${TG_BOT}?startapp`}
          className="glass fixed bottom-3 left-3 z-[60] hidden items-center gap-2 rounded-full px-3 py-1.5 text-[12px] text-mist-200 md:flex"
        >
          <IconTelegram size={14} className="text-[#58a6ff]" /> Open in Telegram
        </a>
      )}
      {mode === "create" ? (
        <div className="relative">
          {outside && (
            <div className="absolute right-4 top-4 z-10 hidden md:block">
              <Wordmark />
            </div>
          )}
          <CreateFlow studioPath="/tg" />
        </div>
      ) : (
        <StudioApp embedded key={q.get("demo") ? "demo" : (q.get("avatar") ?? "active")} />
      )}
    </>
  );
}
