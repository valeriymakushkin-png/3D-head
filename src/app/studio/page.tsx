import type { Metadata } from "next";
import { StudioApp } from "@/components/studio/StudioApp";

export const metadata: Metadata = { title: "Studio", robots: { index: false } };

export default function StudioPage() {
  return <StudioApp />;
}
