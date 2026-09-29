import type { Metadata } from "next";
import { headers } from "next/headers";
import Script from "next/script";
import { Suspense } from "react";
import { TgApp } from "@/components/telegram/TgApp";

export const metadata: Metadata = { title: "TwinMe", robots: { index: false } };

/** Telegram Mini App entry (BotFather → Mini App URL = https://<host>/tg). */
export default async function TelegramPage() {
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  return (
    <>
      <Script src="https://telegram.org/js/telegram-web-app.js?59" strategy="afterInteractive" nonce={nonce} />
      <Suspense>
        <TgApp />
      </Suspense>
    </>
  );
}
