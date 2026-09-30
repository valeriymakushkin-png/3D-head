"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useRef, useState } from "react";
import type { LookOption } from "@/lib/ai/protocol";
import { streamStylist } from "@/lib/api/client";
import { cn } from "@/lib/cn";
import { IconClose, IconSend, IconSparkle, IconUndo } from "@/components/ui/icons";
import { Button, easeOut } from "@/components/ui/primitives";
import { useStudio } from "@/store/studio";

interface Msg {
  id: string;
  role: "user" | "assistant";
  content: string;
  applied?: string[];
  options?: LookOption[];
  error?: { message: string; code?: string };
  pending?: boolean;
}

const PROMPTS = [
  "What suits my face shape?",
  "I have thinning hair",
  "Make me look more professional",
  "Luxury fashion look",
  "Something bolder",
];

function useStylist() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [streaming, setStreaming] = useState(false);
  const abort = useRef<AbortController | null>(null);

  const send = useCallback(
    async (text: string) => {
      const { asset, look, applyPatch, openPanel } = useStudio.getState();
      if (!asset || !text.trim() || streaming) return;
      const user: Msg = { id: crypto.randomUUID(), role: "user", content: text.trim() };
      const reply: Msg = { id: crypto.randomUUID(), role: "assistant", content: "", pending: true };
      const history = [...messages, user];
      setMessages([...history, reply]);
      setStreaming(true);
      abort.current = new AbortController();
      const patch = (fn: (m: Msg) => Msg) => setMessages((ms) => ms.map((m) => (m.id === reply.id ? fn(m) : m)));
      try {
        for await (const ev of streamStylist(
          {
            messages: history.map((m) => ({
              role: m.role,
              content: m.content + (m.applied?.length ? `\n[Applied to the avatar: ${m.applied.join("; ")}]` : "") || "…",
            })),
            context: { analysis: asset.analysis, look: useStudio.getState().look ?? look },
          },
          abort.current.signal,
        )) {
          if (ev.type === "text") patch((m) => ({ ...m, content: m.content + ev.delta, pending: false }));
          else if (ev.type === "apply") {
            applyPatch(ev.patch, "stylist");
            patch((m) => ({ ...m, applied: [...(m.applied ?? []), ev.label], pending: false }));
          } else if (ev.type === "options") patch((m) => ({ ...m, options: ev.options, pending: false }));
          else if (ev.type === "error") {
            patch((m) => ({ ...m, pending: false, error: { message: ev.message, code: ev.code } }));
            if (ev.code === "quota_exceeded") openPanel("paywall");
          }
        }
      } catch (e) {
        if ((e as Error).name !== "AbortError") patch((m) => ({ ...m, pending: false, error: { message: "Connection lost. Try again." } }));
      } finally {
        patch((m) => ({ ...m, pending: false }));
        setStreaming(false);
      }
    },
    [messages, streaming],
  );

  return { messages, streaming, send, stop: () => abort.current?.abort() };
}

export function StylistPanel() {
  const open = useStudio((s) => s.panel === "stylist");
  const openPanel = useStudio((s) => s.openPanel);
  const asset = useStudio((s) => s.asset);
  const undo = useStudio((s) => s.undo);
  const applyPatch = useStudio((s) => s.applyPatch);
  const { messages, streaming, send } = useStylist();
  const [text, setText] = useState("");
  const scroller = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: "smooth" });
  }, [messages]);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 250);
  }, [open]);

  const a = asset?.analysis;
  const submit = () => {
    send(text);
    setText("");
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          initial={{ opacity: 0, x: 40, scale: 0.98 }}
          animate={{ opacity: 1, x: 0, scale: 1 }}
          exit={{ opacity: 0, x: 40, scale: 0.98 }}
          transition={{ duration: 0.45, ease: easeOut }}
          className="glass pointer-events-auto absolute inset-x-2 bottom-2 top-[30%] z-50 !bg-[rgb(14_15_18/0.86)] flex flex-col overflow-hidden rounded-[28px] md:inset-x-auto md:bottom-6 md:right-6 md:top-24 md:w-[400px]"
          aria-label="AI Stylist"
        >
          <header className="flex items-center justify-between px-5 pb-2 pt-4">
            <div className="flex items-center gap-2">
              <IconSparkle size={18} className="text-iris-300" />
              <span className="font-display text-[15px] font-semibold tracking-tight">AI Stylist</span>
            </div>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => openPanel("none")} aria-label="Close stylist">
              <IconClose size={16} />
            </Button>
          </header>

          <div ref={scroller} className="no-scrollbar flex-1 space-y-5 overflow-y-auto px-5 pb-4">
            {messages.length === 0 && a && (
              <div className="pt-2">
                <p className="font-display text-[24px] font-semibold leading-8 text-mist-50">Tell me the look you&apos;re after.</p>
                <p className="mt-2 text-[13px] leading-5 text-mist-400">I can see your twin in 3D and change it as we talk.</p>
                <div className="mt-4 flex flex-wrap gap-1.5">
                  {[`${cap(a.faceShape)} face`, `${cap(a.skin.undertone)} undertone`, `${cap(a.hair.lengthClass)} hair`, `IPD ${a.metrics.ipdMm.toFixed(0)} mm`].map((c) => (
                    <span key={c} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-mist-300">
                      {c}
                    </span>
                  ))}
                </div>
                <div className="mt-6 flex flex-col gap-2">
                  {PROMPTS.map((p) => (
                    <button key={p} onClick={() => send(p)} className="glass-soft rounded-2xl px-4 py-3 text-left text-[14px] text-mist-200 transition-colors hover:bg-white/[0.07]">
                      {p}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((m) =>
              m.role === "user" ? (
                <div key={m.id} className="flex justify-end">
                  <p className="max-w-[85%] rounded-[20px] rounded-br-md bg-white/[0.09] px-4 py-2.5 text-[14px] leading-5 text-mist-50">{m.content}</p>
                </div>
              ) : (
                <div key={m.id} className="space-y-3">
                  {m.pending && !m.content && <p className="text-shimmer text-[14px]">Looking at your twin…</p>}
                  {m.content && <p className="whitespace-pre-wrap text-[14px] leading-[22px] text-mist-200">{m.content}</p>}
                  {m.applied?.map((l) => (
                    <div key={l} className="flex items-center justify-between rounded-2xl border border-iris-400/25 bg-iris-400/[0.07] px-3.5 py-2.5">
                      <span className="text-[13px] text-iris-200">Applied · {l}</span>
                      <button onClick={undo} className="flex items-center gap-1 text-[12px] text-mist-400 hover:text-mist-100">
                        <IconUndo size={14} /> Undo
                      </button>
                    </div>
                  ))}
                  {m.options && (
                    <div className="grid gap-2">
                      {m.options.map((o) => (
                        <button
                          key={o.label}
                          onClick={() => applyPatch(o.patch, "stylist")}
                          className="glass-soft rounded-2xl px-4 py-3 text-left transition-colors hover:bg-white/[0.08]"
                        >
                          <span className="block text-[14px] font-medium text-mist-50">{o.label}</span>
                          <span className="mt-0.5 block text-[12px] leading-4 text-mist-400">{o.why}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {m.error && (
                    <p className={cn("rounded-2xl px-3.5 py-2.5 text-[13px]", m.error.code === "quota_exceeded" ? "bg-aura-400/10 text-aura-300" : "bg-err-400/10 text-err-400")}>{m.error.message}</p>
                  )}
                </div>
              ),
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              submit();
            }}
            className="m-3 mt-0 flex items-end gap-2 rounded-[22px] border border-white/10 bg-black/20 p-1.5 pl-4"
          >
            <textarea
              ref={input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={600}
              placeholder="Ask for any look…"
              className="max-h-32 min-h-[36px] flex-1 resize-none bg-transparent py-2 text-[14px] text-mist-50 placeholder:text-mist-500 focus:outline-none"
            />
            <Button type="submit" variant="solid" size="icon" className="size-9" disabled={!text.trim() || streaming} aria-label="Send">
              <IconSend size={16} />
            </Button>
          </form>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace("_", " ");
