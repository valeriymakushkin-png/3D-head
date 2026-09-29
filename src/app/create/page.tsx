import type { Metadata } from "next";
import { CreateFlow } from "@/components/capture/CreateFlow";

export const metadata: Metadata = { title: "Create your twin" };

export default function CreatePage() {
  return <CreateFlow />;
}
