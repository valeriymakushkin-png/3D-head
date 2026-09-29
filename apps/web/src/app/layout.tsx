import type { Metadata, Viewport } from "next";
import { Inter, Inter_Tight, Instrument_Serif } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin", "cyrillic"], variable: "--font-inter", display: "swap" });
const interTight = Inter_Tight({ subsets: ["latin", "cyrillic"], variable: "--font-inter-tight", display: "swap" });
const instrument = Instrument_Serif({
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
  variable: "--font-instrument",
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://twinme.ai";

// Per-request CSP nonces (see middleware.ts) require dynamic rendering.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: { default: "TwinMe — your photoreal 3D digital twin", template: "%s · TwinMe" },
  description:
    "Scan your head in 15 seconds. Get a real 3D twin. Try any haircut, beard, colour or glasses on yourself in real time — before you commit.",
  applicationName: "TwinMe",
  openGraph: {
    type: "website",
    siteName: "TwinMe",
    title: "Meet your digital twin",
    description: "A photoreal 3D twin of your head. Try any look on yourself, in real time.",
  },
  twitter: { card: "summary_large_image" },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#050506",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${interTight.variable} ${instrument.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
