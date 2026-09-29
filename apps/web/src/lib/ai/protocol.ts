import { z } from "zod";
import { LookPatchSchema, LookSchema } from "@/lib/avatar/look";
import { FaceAnalysisSchema } from "@/lib/style/analysis";

/** Wire protocol between the studio and /api/stylist (server-sent events). */

export const StylistMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().min(1).max(4000),
});

export const StylistRequestSchema = z.object({
  messages: z.array(StylistMessageSchema).min(1).max(40),
  context: z.object({
    analysis: FaceAnalysisSchema,
    look: LookSchema,
  }),
});
export type StylistRequest = z.infer<typeof StylistRequestSchema>;

export const LookOptionSchema = z.object({
  label: z.string().max(60),
  why: z.string().max(240),
  patch: LookPatchSchema,
});
export type LookOption = z.infer<typeof LookOptionSchema>;

export type StylistEvent =
  | { type: "text"; delta: string }
  | { type: "apply"; label: string; patch: z.infer<typeof LookPatchSchema> }
  | { type: "options"; options: LookOption[] }
  | { type: "usage"; remaining: number | null }
  | { type: "done" }
  | { type: "error"; message: string; code?: "quota_exceeded" | "unauthorized" | "rate_limited" | "unavailable" | "bad_request" };

export function encodeEvent(e: StylistEvent): string {
  return `data: ${JSON.stringify(e)}\n\n`;
}

/** Parses an SSE byte stream into events. */
export async function* readEvents(body: ReadableStream<Uint8Array>): AsyncGenerator<StylistEvent> {
  const reader = body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const chunk = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = chunk.split("\n").find((l) => l.startsWith("data: "));
      if (line) yield JSON.parse(line.slice(6)) as StylistEvent;
    }
  }
}
