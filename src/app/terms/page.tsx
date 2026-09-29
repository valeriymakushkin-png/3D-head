import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/ui/Logo";

export const metadata: Metadata = { title: "Terms" };

const terms: Array<[string, string]> = [
  ["The service", "TwinMe creates a 3D visualisation of your head and lets you preview appearance changes. Previews are simulations: real results depend on your hair, skin and the professional you work with."],
  ["Your content", "You must only scan yourself, or someone who has given you explicit consent (professional plans must record client consent). You keep all rights to your photos and your twin."],
  ["Subscriptions", "Paid plans renew monthly until cancelled. Cancel any time from the studio (web) or Telegram; access continues to the end of the paid period. Telegram purchases are made in Stars and governed by Telegram's terms."],
  ["Not medical advice", "Hairline and density simulations for clinics are visual aids, not diagnoses or outcome guarantees."],
  ["Acceptable use", "No scanning minors, no impersonation, no attempts to extract other users' data or to reverse-engineer the service."],
];

export default function Terms() {
  return (
    <main className="mx-auto max-w-2xl px-5 py-16 text-mist-200">
      <Link href="/">
        <Wordmark />
      </Link>
      <h1 className="mt-12 font-display text-[40px] font-semibold tracking-[-0.03em] text-mist-50">Terms</h1>
      {terms.map(([h, p]) => (
        <section key={h} className="mt-10">
          <h2 className="text-[17px] font-semibold text-mist-50">{h}</h2>
          <p className="mt-2 text-[15px] leading-7 text-mist-400">{p}</p>
        </section>
      ))}
    </main>
  );
}
