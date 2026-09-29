import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { StylistEvent, StylistRequest } from "@/lib/ai/protocol";
import { env } from "@/server/env";
import { ApplyLookInput, STYLIST_SYSTEM, STYLIST_TOOLS, SuggestLooksInput, currentLookMessage, userContextBlock } from "@/server/ai/prompts";

type Emit = (e: StylistEvent) => void;
type Usage = { input_tokens: number; output_tokens: number; cache_read_input_tokens: number };

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 2, timeout: 60_000 }));

const MAX_TURNS = 4;

/**
 * Streams one stylist reply. apply_look / suggest_looks are *client-side*
 * tools: we validate the input, forward it to the studio as an SSE event
 * (the twin changes live), and answer the tool call with a short result so
 * the model can finish its explanation in the same reply.
 *
 * Harness is append-only (full assistant content, thinking blocks included,
 * is appended every loop) as required for preserved thinking.
 */
export async function runStylist(req: StylistRequest, emit: Emit, signal: AbortSignal): Promise<Usage> {
  const usage: Usage = { input_tokens: 0, output_tokens: 0, cache_read_input_tokens: 0 };
  const messages: Anthropic.Beta.BetaMessageParam[] = req.messages.map((m) => ({ role: m.role, content: m.content }));
  // Live state goes in a mid-conversation system message after the last user
  // turn, so the cached system prefix stays byte-identical across requests.
  messages.push({ role: "system", content: currentLookMessage(req.context.look) });

  const tools: Anthropic.Beta.BetaToolUnion[] = STYLIST_TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.input_schema as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const stream = anthropic().beta.messages.stream(
      {
        model: env().STYLIST_MODEL,
        max_tokens: 4000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: env().STYLIST_EFFORT },
        system: [
          { type: "text", text: STYLIST_SYSTEM, cache_control: { type: "ephemeral" } },
          { type: "text", text: userContextBlock(req.context.analysis), cache_control: { type: "ephemeral" } },
        ],
        tools,
        messages,
      },
      { signal },
    );
    stream.on("text", (delta) => emit({ type: "text", delta }));

    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await stream.finalMessage();
    } catch (err) {
      // Unparseable eager tool input: re-issue the turn once; API errors propagate.
      if (err instanceof Anthropic.APIError || turn > 1) throw err;
      continue;
    }
    usage.input_tokens += message.usage.input_tokens;
    usage.output_tokens += message.usage.output_tokens;
    usage.cache_read_input_tokens += message.usage.cache_read_input_tokens ?? 0;

    if (message.stop_reason === "refusal") {
      emit({ type: "error", code: "bad_request", message: "I can only help with your look — try asking about hair, beard, colour or glasses." });
      return usage;
    }
    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (toolUses.length === 0 || message.stop_reason === "end_turn") return usage;
    if (message.stop_reason === "max_tokens") {
      emit({ type: "error", code: "unavailable", message: "That answer ran long — ask again for a shorter version." });
      return usage;
    }

    messages.push({ role: "assistant", content: message.content });
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = toolUses.map((t) => {
      if (t.name === "apply_look") {
        const parsed = ApplyLookInput.safeParse(t.input);
        if (!parsed.success) {
          return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Invalid look: ${parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}` };
        }
        const { label, ...patch } = parsed.data;
        emit({ type: "apply", label, patch });
        return { type: "tool_result", tool_use_id: t.id, content: `Applied "${label}". The user now sees it on their twin.` };
      }
      if (t.name === "suggest_looks") {
        const parsed = SuggestLooksInput.safeParse(t.input);
        if (!parsed.success) {
          return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Invalid options: ${parsed.error.issues[0]?.message}` };
        }
        emit({ type: "options", options: parsed.data.options });
        return { type: "tool_result", tool_use_id: t.id, content: "Options shown to the user as tappable cards." };
      }
      return { type: "tool_result", tool_use_id: t.id, is_error: true, content: `Unknown tool ${t.name}` };
    });
    messages.push({ role: "user", content: results });
  }
  return usage;
}
