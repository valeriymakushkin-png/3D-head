import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Privacy" };

const sections: Array<[string, string]> = [
  ["What we process", "Instant Twins are built entirely in your browser: your photos, facial landmarks and the resulting 3D model stay on your device (IndexedDB) unless you choose to sync or order an HD Twin."],
  ["HD Twins", "If you order an HD Twin, your capture photos are uploaded over TLS to encrypted private storage, processed by our GPU service, and permanently deleted within 48 hours. The resulting model is stored privately and served only through short-lived signed links."],
  ["Biometric data", "A 3D face model can be biometric data (GDPR Art. 9, BIPA, CCPA). We process it only to provide the service you asked for, with your explicit consent at capture time. We never use your face to train models, never sell it, and never use it for identification."],
  ["AI Stylist", "When you chat with the AI Stylist we send your text and numeric measurements (face-shape ratios, skin-tone category, current look) to our AI provider — never your photos. Providers are contractually barred from training on this data."],
  ["Accounts & payments", "Signing in with Telegram shares your Telegram id and public name. Payments are handled by Stripe or Telegram; we never see card details."],
  ["Your rights", "Delete any avatar from the studio at any time (files are erased immediately). To export or erase your account, email privacy@twinme.ai — we respond within 30 days."],
];

export default function Privacy() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 text-mist-200">
      <Link href="/">
        <Wordmark />
      </Link>
      <h1 className="mt-12 font-display text-[40px] font-semibold tracking-[-0.03em] text-mist-50">Privacy</h1>
      <p className="mt-3 text-[15px] text-mist-400">Your face is yours. This is how we keep it that way.</p>
      {sections.map(([h, p]) => (
        <section key={h} className="mt-10">
          <h2 className="text-[17px] font-semibold text-mist-50">{h}</h2>
          <p className="mt-2 text-[15px] leading-7 text-mist-400">{p}</p>
        </section>
      ))}
    </main>
  );
}
