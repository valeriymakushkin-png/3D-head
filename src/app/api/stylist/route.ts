import Anthropic from "@anthropic-ai/sdk";
import { type StylistEvent, StylistRequestSchema, encodeEvent } from "@/lib/ai/protocol";
import { runStylist } from "@/server/ai/stylist";
import { openAiFallbackEnabled, runStylistOpenAI } from "@/server/ai/openai-fallback";
import { env, features } from "@/server/env";
import { HttpError, body, clientIp, route } from "@/server/http";
import { meter, recordAiUsage } from "@/server/metering";
import { rateLimit } from "@/server/ratelimit";
import { ensureSession } from "@/server/session";

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * POST /api/stylist → text/event-stream of StylistEvent.
 * Free tier: each request consumes one transformation; Pro+: unlimited.
 */
export const POST = route(async (req: Request) => {
  if (!features.ai()) throw new HttpError(503, "unavailable", "AI is not configured");
  const session = await ensureSession();
  await rateLimit(`stylist:${session.userId}`, 20, 60);
  await rateLimit(`stylist-ip:${clientIp(req)}`, 60, 60);
  const input = await body(req, StylistRequestSchema, 48_000);
  const { remaining } = await meter(session, { type: "stylist", avatarId: null, settings: { prompt: input.messages.at(-1)?.content.slice(0, 200) }, source: "stylist" });

  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (e: StylistEvent) => controller.enqueue(enc.encode(encodeEvent(e)));
      emit({ type: "usage", remaining });
      try {
        if (env().ANTHROPIC_API_KEY) {
          const usage = await runStylist(input, emit, req.signal);
          await recordAiUsage(session.userId, "stylist", env().STYLIST_MODEL, usage);
        } else {
          await runStylistOpenAI(input, emit, req.signal);
        }
      } catch (err) {
        const transient =
          err instanceof Anthropic.APIConnectionError ||
          err instanceof Anthropic.InternalServerError ||
          (err instanceof Anthropic.APIError && (err.status === 529 || err.status === 503));
        if (transient && openAiFallbackEnabled()) {
          try {
            await runStylistOpenAI(input, emit, req.signal);
          } catch (e2) {
            console.error("[stylist] fallback failed", e2);
            emit({ type: "error", code: "unavailable", message: "The stylist is busy — try again in a moment." });
          }
        } else if (err instanceof Anthropic.RateLimitError) {
          emit({ type: "error", code: "rate_limited", message: "Lots of people are styling right now — try again shortly." });
        } else if (!req.signal.aborted) {
          console.error("[stylist]", err);
          emit({ type: "error", code: "unavailable", message: "The stylist is unavailable right now." });
        }
      } finally {
        emit({ type: "done" });
        controller.close();
      }
    },
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
});
