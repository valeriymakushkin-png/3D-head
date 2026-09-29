import { notFound } from "next/navigation";
import { LabClient } from "./LabClient";

export const metadata = { title: "Lab", robots: { index: false } };

/** Engineering lab: deterministic renders for visual QA and rig generation. */
export default function LabPage() {
  if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_ENABLE_LAB !== "1") notFound();
  return <LabClient />;
}
