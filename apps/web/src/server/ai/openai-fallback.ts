import "server-only";
import OpenAI from "openai";
import type { StylistEvent, StylistRequest } from "@/lib/ai/protocol";
import { env } from "@/server/env";
import { ApplyLookInput, STYLIST_SYSTEM, STYLIST_TOOLS, SuggestLooksInput, currentLookMessage, userContextBlock } from "@/server/ai/prompts";

/**
 * Provider failover for the stylist: used only when Claude is unreachable
 * (5xx / overloaded / network) AND both OPENAI_API_KEY and
 * OPENAI_FALLBACK_MODEL are configured. Single non-streaming turn — degraded
 * but functional, so the studio never shows a dead chat.
 */
export function openAiFallbackEnabled() {
  return !!(env().OPENAI_API_KEY && env().OPENAI_FALLBACK_MODEL);
}

export async function runStylistOpenAI(req: StylistRequest, emit: (e: StylistEvent) => void, signal: AbortSignal) {
  const client = new OpenAI({ apiKey: env().OPENAI_API_KEY, timeout: 30_000, maxRetries: 1 });
  const res = await client.chat.completions.create(
    {
      model: env().OPENAI_FALLBACK_MODEL!,
      messages: [
        { role: "system", content: `${STYLIST_SYSTEM}\n\n${userContextBlock(req.context.analysis)}` },
        ...req.messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "system", content: currentLookMessage(req.context.look) },
      ],
      tools: STYLIST_TOOLS.map((t) => ({
        type: "function" as const,
        function: { name: t.name, description: t.description, parameters: t.input_schema as Record<string, unknown> },
      })),
    },
    { signal },
  );
  const msg = res.choices[0]?.message;
  if (!msg) return;
  for (const call of msg.tool_calls ?? []) {
    if (call.type !== "function") continue;
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments);
    } catch {
      continue;
    }
    if (call.function.name === "apply_look") {
      const p = ApplyLookInput.safeParse(input);
      if (p.success) {
        const { label, ...patch } = p.data;
        emit({ type: "apply", label, patch });
      }
    } else if (call.function.name === "suggest_looks") {
      const p = SuggestLooksInput.safeParse(input);
      if (p.success) emit({ type: "options", options: p.data.options });
    }
  }
  if (msg.content) emit({ type: "text", delta: msg.content });
  else if (msg.tool_calls?.length) emit({ type: "text", delta: "Here you go — take a look at your twin." });
}
