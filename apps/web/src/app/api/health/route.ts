import { features } from "@/server/env";
import { json } from "@/server/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
  return json({
    ok: true,
    features: { backend: features.backend(), telegram: features.telegram(), stripe: features.stripe(), ai: features.ai() },
    version: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
  });
}
