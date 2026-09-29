import type { Metadata } from "next";
import Link from "next/link";
import { TelegramLoginButton } from "@/components/auth/TelegramLoginButton";
import { IconShield, IconTelegram } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Sign in", robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = sp.next?.startsWith("/") && !sp.next.startsWith("//") ? sp.next : "/studio";
  const bot = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "TwinMeAIBot";
  return (
    <main className="relative grid min-h-dvh place-items-center overflow-hidden bg-ink-950 px-5">
      <div className="absolute inset-0 bg-[radial-gradient(50%_45%_at_50%_30%,#1b1c22,transparent)]" />
      <div className="relative w-full max-w-sm">
        <Link href="/" className="mb-10 inline-block">
          <Wordmark />
        </Link>
        <h1 className="font-display text-[34px] font-semibold leading-tight tracking-[-0.03em]">Sign in to sync your twin</h1>
        <p className="mt-3 text-[15px] leading-6 text-mist-400">Your Instant Twin already lives on this device. Sign in to keep your looks across devices and unlock Pro.</p>
        {sp.error && <p className="mt-4 rounded-2xl bg-err-400/10 px-4 py-3 text-[13px] text-err-400">Telegram sign-in didn&apos;t complete. Please try again.</p>}
        <div className="glass mt-8 rounded-[28px] p-6">
          <TelegramLoginButton bot={bot} next={next} />
          <div className="my-5 h-px bg-white/[0.07]" />
          <a href={`https://t.me/${bot}/app`} className="flex items-center justify-center gap-2 rounded-full bg-white/[0.07] px-5 py-3 text-[14px] text-mist-100 hover:bg-white/[0.1]">
            <IconTelegram size={18} className="text-[#58a6ff]" /> Open the Telegram app instead
          </a>
        </div>
        <p className="mt-6 flex items-start gap-2 text-[12px] leading-5 text-mist-500">
          <IconShield size={16} className="mt-0.5 shrink-0" /> We receive your Telegram name and id only — never your phone number or messages.
        </p>
      </div>
    </main>
  );
}
