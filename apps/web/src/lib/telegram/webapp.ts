"use client";

/** Typed subset of the Telegram Mini Apps runtime (telegram-web-app.js, Bot API 8+). */
export interface TelegramWebApp {
  initData: string;
  initDataUnsafe: {
    user?: { id: number; first_name: string; last_name?: string; username?: string; language_code?: string; photo_url?: string; is_premium?: boolean };
    start_param?: string;
    auth_date?: number;
  };
  version: string;
  platform: string;
  colorScheme: "light" | "dark";
  themeParams: Record<string, string>;
  isExpanded: boolean;
  viewportHeight: number;
  viewportStableHeight: number;
  safeAreaInset?: { top: number; bottom: number; left: number; right: number };
  contentSafeAreaInset?: { top: number; bottom: number; left: number; right: number };
  ready(): void;
  expand(): void;
  close(): void;
  isVersionAtLeast(v: string): boolean;
  requestFullscreen?(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor(color: string): void;
  setBackgroundColor(color: string): void;
  setBottomBarColor?(color: string): void;
  BackButton: { isVisible: boolean; show(): void; hide(): void; onClick(cb: () => void): void; offClick(cb: () => void): void };
  MainButton: {
    setText(t: string): void;
    show(): void;
    hide(): void;
    enable(): void;
    disable(): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean; has_shine_effect?: boolean }): void;
  };
  HapticFeedback: {
    impactOccurred(style: "light" | "medium" | "heavy" | "rigid" | "soft"): void;
    notificationOccurred(type: "error" | "success" | "warning"): void;
    selectionChanged(): void;
  };
  openInvoice(url: string, cb?: (status: "paid" | "cancelled" | "failed" | "pending") => void): void;
  openLink(url: string, opts?: { try_instant_view?: boolean }): void;
  shareToStory?(mediaUrl: string, params?: { text?: string; widget_link?: { url: string; name?: string } }): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
}

declare global {
  interface Window {
    Telegram?: { WebApp: TelegramWebApp };
  }
}

export function getTelegram(): TelegramWebApp | null {
  if (typeof window === "undefined") return null;
  const tg = window.Telegram?.WebApp;
  return tg && tg.initData ? tg : null;
}

export function haptic(kind: "tap" | "select" | "success" | "error" = "tap") {
  const h = getTelegram()?.HapticFeedback;
  if (!h) {
    if (kind !== "select" && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(kind === "error" ? [20, 40, 20] : 8);
    return;
  }
  if (kind === "tap") h.impactOccurred("light");
  else if (kind === "select") h.selectionChanged();
  else h.notificationOccurred(kind);
}
