import Link from "next/link";
import { HeroTwinLazy } from "@/components/landing/HeroTwinLazy";
import { Reveal } from "@/components/landing/Reveal";
import { IconCheck, IconCube, IconHd, IconShield, IconSparkle, IconTelegram, IconWand } from "@/components/ui/icons";
import { Wordmark } from "@/components/ui/Logo";

const TG_BOT = process.env.NEXT_PUBLIC_TELEGRAM_BOT_USERNAME ?? "TwinMeAIBot";

export default function Landing() {
  return (
    <main className="relative overflow-x-clip bg-ink-950 text-mist-100">
      <Nav />
      <Hero />
      <HowItWorks />
      <Features />
      <Pros />
      <Pricing />
      <Closing />
      <Footer />
    </main>
  );
}

function Nav() {
  return (
    <header className="fixed inset-x-0 top-0 z-50">
      <div className="mx-auto flex max-w-7xl items-center justify-between px-5 py-4 md:px-8">
        <Link href="/" aria-label="TwinMe home">
          <Wordmark />
        </Link>
        <nav className="glass-soft hidden items-center gap-1 rounded-full p-1 text-[13px] text-mist-300 md:flex">
          {[
            ["How it works", "#how"],
            ["Features", "#features"],
            ["For pros", "#pros"],
            ["Pricing", "#pricing"],
          ].map(([l, h]) => (
            <a key={h} href={h} className="rounded-full px-4 py-1.5 transition-colors hover:bg-white/[0.06] hover:text-mist-50">
              {l}
            </a>
          ))}
        </nav>
        <div className="flex items-center gap-2">
          <Link href="/login" className="hidden rounded-full px-4 py-2 text-[13px] text-mist-300 hover:text-mist-50 sm:block">
            Sign in
          </Link>
          <Link href="/create" className="rounded-full bg-mist-50 px-4 py-2 text-[13px] font-medium text-ink-950 transition-transform hover:scale-[1.03]">
            Create my twin
          </Link>
        </div>
      </div>
    </header>
  );
}

function Hero() {
  return (
    <section className="relative min-h-[100svh]">
      <div className="absolute inset-0 bg-[radial-gradient(55%_60%_at_68%_45%,#1b1c22_0%,#0a0a0c_60%,#050506_100%)]" />
      <div className="absolute inset-y-0 right-0 w-full md:w-[62%]">
        <HeroTwinLazy />
      </div>
      <div className="stage-vignette absolute inset-0" />
      <div className="relative mx-auto flex min-h-[100svh] max-w-7xl flex-col justify-end px-5 pb-16 pt-28 md:justify-center md:px-8 md:pb-0">
        <Reveal className="max-w-[560px]">
          <p className="glass-soft inline-flex items-center gap-2 rounded-full px-3 py-1 text-[12px] text-mist-300">
            <span className="size-1.5 rounded-full bg-iris-400" /> Real 3D. Built from your own photos.
          </p>
          <h1 className="mt-6 font-display text-[52px] font-semibold leading-[0.98] tracking-[-0.045em] md:text-[84px]">
            Meet your
            <br />
            <span className="font-serif font-normal italic tracking-[-0.02em] text-mist-300">digital twin.</span>
          </h1>
          <p className="mt-6 max-w-[440px] text-[17px] leading-7 text-mist-400">
            A photoreal 3D model of your head from a 15-second selfie scan. Try any haircut, beard, colour or frames — on <em className="not-italic text-mist-100">you</em>, in real time,
            before you commit.
          </p>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            <Link href="/create" className="group inline-flex h-13 items-center gap-2 rounded-full bg-mist-50 px-7 text-[15px] font-medium text-ink-950 shadow-[0_18px_60px_-18px_rgba(255,255,255,0.5)] transition-transform hover:scale-[1.02]">
              Create my 3D twin
              <span className="transition-transform group-hover:translate-x-0.5">→</span>
            </Link>
            <a href={`https://t.me/${TG_BOT}/app`} className="glass inline-flex h-13 items-center gap-2 rounded-full px-6 text-[15px] text-mist-100 transition-colors hover:bg-white/[0.07]">
              <IconTelegram size={18} className="text-[#58a6ff]" /> Open in Telegram
            </a>
          </div>
          <p className="mt-6 text-[13px] text-mist-500">
            Free to start · Private by design · <Link href="/studio?demo=1" className="text-mist-300 underline-offset-4 hover:underline">try the demo twin</Link>
          </p>
        </Reveal>
      </div>
    </section>
  );
}

function HowItWorks() {
  const steps = [
    ["01", "Scan", "Turn your head slowly for 15 seconds. The camera tracks 478 facial points and captures seven angles automatically."],
    ["02", "Sculpt", "Your photos are fused into a sculpted 3D head and a 2K skin texture — on your device, in seconds."],
    ["03", "Try everything", "Swap cuts, beards, colours and frames in real time. Rotate 360°. See the back of your own head."],
  ];
  return (
    <section id="how" className="relative mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-40">
      <Reveal>
        <h2 className="max-w-2xl font-display text-[38px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[56px]">
          From selfie to twin <span className="font-serif font-normal italic text-mist-400">in under a minute.</span>
        </h2>
      </Reveal>
      <div className="mt-16 grid gap-10 md:grid-cols-3 md:gap-8">
        {steps.map(([n, t, d], i) => (
          <Reveal key={n} delay={i * 0.1}>
            <div className="border-t border-white/10 pt-6">
              <span className="font-display text-[15px] tabular-nums text-mist-500">{n}</span>
              <h3 className="mt-3 font-display text-[26px] font-semibold tracking-[-0.02em]">{t}</h3>
              <p className="mt-3 text-[15px] leading-7 text-mist-400">{d}</p>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Features() {
  return (
    <section id="features" className="mx-auto max-w-7xl px-5 pb-28 md:px-8 md:pb-40">
      <div className="grid gap-3 md:grid-cols-6 md:grid-rows-2">
        <Reveal className="md:col-span-4">
          <Card className="h-full min-h-[300px]">
            <IconSparkle size={22} className="text-iris-300" />
            <h3 className="mt-5 font-display text-[28px] font-semibold tracking-[-0.02em]">AI Stylist</h3>
            <p className="mt-2 max-w-md text-[15px] leading-7 text-mist-400">Ask like you would a great barber. It reads your face shape, proportions and undertone — and restyles your twin as it answers.</p>
            <div className="mt-6 flex max-w-md flex-col gap-2">
              <span className="self-end rounded-[18px] rounded-br-md bg-white/[0.08] px-4 py-2 text-[14px]">I have thinning hair — what works?</span>
              <span className="rounded-[18px] rounded-bl-md border border-iris-400/25 bg-iris-400/[0.07] px-4 py-2 text-[14px] text-iris-200">Applied · Textured Crop · Stubble</span>
            </div>
          </Card>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.08}>
          <Card className="h-full">
            <IconWand size={22} className="text-aura-300" />
            <h3 className="mt-5 font-display text-[24px] font-semibold tracking-[-0.02em]">Glow Up</h3>
            <p className="mt-2 text-[15px] leading-7 text-mist-400">One tap: “show me my best version”. A live 3D before/after you can rotate.</p>
          </Card>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.12}>
          <Card className="h-full">
            <IconCube size={22} />
            <h3 className="mt-5 font-display text-[24px] font-semibold tracking-[-0.02em]">Real 3D, 360°</h3>
            <p className="mt-2 text-[15px] leading-7 text-mist-400">Strand-level hair grown on your actual scalp. Front, profiles and back — live.</p>
          </Card>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.16}>
          <Card className="h-full">
            <IconShield size={22} className="text-ok-400" />
            <h3 className="mt-5 font-display text-[24px] font-semibold tracking-[-0.02em]">Private by design</h3>
            <p className="mt-2 text-[15px] leading-7 text-mist-400">Your Instant Twin is built on-device. Your face is not training data. Ever.</p>
          </Card>
        </Reveal>
        <Reveal className="md:col-span-2" delay={0.2}>
          <Card className="h-full">
            <IconHd size={22} />
            <h3 className="mt-5 font-display text-[24px] font-semibold tracking-[-0.02em]">HD export</h3>
            <p className="mt-2 text-[15px] leading-7 text-mist-400">4K studio portraits and a GLB of your twin for your barber — or your game.</p>
          </Card>
        </Reveal>
      </div>
    </section>
  );
}

function Pros() {
  return (
    <section id="pros" className="relative border-y border-white/[0.06] bg-ink-900">
      <div className="mx-auto grid max-w-7xl gap-12 px-5 py-28 md:grid-cols-2 md:px-8 md:py-36">
        <Reveal>
          <p className="text-[12px] font-medium uppercase tracking-[0.16em] text-mist-500">For professionals</p>
          <h2 className="mt-4 font-display text-[38px] font-semibold leading-[1.05] tracking-[-0.035em] md:text-[52px]">
            The consultation, <span className="font-serif font-normal italic text-mist-400">before the cut.</span>
          </h2>
          <p className="mt-5 max-w-md text-[16px] leading-7 text-mist-400">
            Barbers show clients the result on their own head before picking up the clippers. Hair-restoration clinics simulate hairline and density, then send a report.
          </p>
        </Reveal>
        <div className="grid gap-3">
          {[
            ["Barbers", "Client twins, saved cuts, consultation mode on a shared screen. Fewer “that’s not what I asked for”."],
            ["Hair transplant clinics", "Hairline design and graft-density simulation on the patient’s real scalp, with a PDF plan."],
            ["Stylists & aesthetics", "Colour, frames and grooming plans your clients can rotate at home."],
          ].map(([t, d], i) => (
            <Reveal key={t} delay={i * 0.08}>
              <Card>
                <h3 className="font-display text-[20px] font-semibold tracking-[-0.02em]">{t}</h3>
                <p className="mt-1.5 text-[14px] leading-6 text-mist-400">{d}</p>
              </Card>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

const PLANS = [
  { name: "Free", price: "$0", cta: "Start free", href: "/create", points: ["Your 3D twin", "Unlimited manual try-ons", "3 AI transformations"] },
  { name: "Pro", price: "$12", cta: "Go Pro", href: "/studio?upgrade=pro", points: ["Unlimited AI transformations", "AI Stylist & custom prompts", "HD export & GLB", "HD cloud twin"], featured: true },
  { name: "Barber", price: "$49", cta: "For barbers", href: "/studio?upgrade=barber", points: ["Client management", "Saved hairstyles per client", "Consultation mode", "Everything in Pro"] },
  { name: "Clinic", price: "$199", cta: "For clinics", href: "/studio?upgrade=clinic", points: ["Hairline & density simulation", "Patient reports (PDF)", "Team seats", "Everything in Barber"] },
];

function Pricing() {
  return (
    <section id="pricing" className="mx-auto max-w-7xl px-5 py-28 md:px-8 md:py-40">
      <Reveal>
        <h2 className="font-display text-[38px] font-semibold tracking-[-0.035em] md:text-[52px]">Pricing</h2>
        <p className="mt-3 text-[16px] text-mist-400">Monthly. Cancel anytime. In Telegram, pay with Stars.</p>
      </Reveal>
      <div className="mt-12 grid gap-3 md:grid-cols-4">
        {PLANS.map((p, i) => (
          <Reveal key={p.name} delay={i * 0.06}>
            <div className={`flex h-full flex-col rounded-[28px] p-6 ${p.featured ? "glass ai-ring" : "glass-soft"}`}>
              <h3 className="text-[15px] font-semibold">{p.name}</h3>
              <p className="mt-3 font-display text-[40px] font-semibold tracking-[-0.03em]">
                {p.price}
                <span className="text-[14px] font-normal text-mist-500">/mo</span>
              </p>
              <ul className="mt-5 flex-1 space-y-2.5">
                {p.points.map((x) => (
                  <li key={x} className="flex gap-2 text-[14px] text-mist-300">
                    <IconCheck size={16} className="mt-0.5 shrink-0 text-ok-400" />
                    {x}
                  </li>
                ))}
              </ul>
              <Link href={p.href} className={`mt-7 inline-flex h-11 items-center justify-center rounded-full text-[14px] font-medium transition-transform hover:scale-[1.02] ${p.featured ? "bg-mist-50 text-ink-950" : "bg-white/[0.07] text-mist-100"}`}>
                {p.cta}
              </Link>
            </div>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function Closing() {
  return (
    <section className="relative overflow-hidden border-t border-white/[0.06]">
      <div className="absolute inset-0 bg-[radial-gradient(50%_80%_at_50%_100%,rgba(159,173,255,0.12),transparent)]" />
      <div className="relative mx-auto max-w-4xl px-5 py-32 text-center md:py-44">
        <Reveal>
          <h2 className="font-display text-[44px] font-semibold leading-[1] tracking-[-0.04em] md:text-[72px]">
            See it on you <span className="font-serif font-normal italic text-mist-400">first.</span>
          </h2>
          <Link href="/create" className="mt-10 inline-flex h-13 items-center rounded-full bg-mist-50 px-8 text-[15px] font-medium text-ink-950 transition-transform hover:scale-[1.03]">
            Create my 3D twin
          </Link>
        </Reveal>
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06]">
      <div className="mx-auto flex max-w-7xl flex-col gap-6 px-5 py-10 text-[12px] text-mist-500 md:flex-row md:items-center md:justify-between md:px-8">
        <Wordmark />
        <div className="flex flex-wrap gap-5">
          <Link href="/privacy" className="hover:text-mist-200">
            Privacy
          </Link>
          <Link href="/terms" className="hover:text-mist-200">
            Terms
          </Link>
          <a href="mailto:hello@twinme.ai" className="hover:text-mist-200">
            hello@twinme.ai
          </a>
        </div>
        <p className="max-w-sm leading-5">Demo head: “Lee Perry-Smith” scan by Infinite-Realities, CC BY 3.0. © {new Date().getFullYear()} TwinMe AI, Inc.</p>
      </div>
    </footer>
  );
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`glass-soft rounded-[28px] p-7 ${className}`}>{children}</div>;
}
