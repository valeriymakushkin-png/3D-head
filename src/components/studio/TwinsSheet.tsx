"use client";

import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { type InstantTwinRecord, avatarVault, deleteTwin, setActiveAvatarId } from "@/lib/recon/storage";
import { cn } from "@/lib/cn";
import { Sheet } from "@/components/studio/Sheets";
import { IconCamera, IconChevron, IconTrash } from "@/components/ui/icons";
import { Button } from "@/components/ui/primitives";
import { useStudio } from "@/store/studio";

const inTelegram = () => typeof window !== "undefined" && window.location.pathname.startsWith("/tg");

/** Face picture for a twin: the thumbnail saved at scan time, else a crop of its skin atlas. */
function useTwinImages(twins: InstantTwinRecord[] | null) {
  const urls = useMemo(
    () => new Map((twins ?? []).map((t) => [t.id, { url: URL.createObjectURL(t.thumbnail ?? t.albedo), atlas: !t.thumbnail }])),
    [twins],
  );
  useEffect(() => () => urls.forEach((u) => URL.revokeObjectURL(u.url)), [urls]);
  return urls;
}

export function TwinAvatar({ url, atlas, className }: { url?: string; atlas?: boolean; className?: string }) {
  return (
    <span
      className={cn("block shrink-0 overflow-hidden rounded-full bg-[radial-gradient(circle_at_35%_30%,#d8b69b,#6b4c3b)] bg-no-repeat", className)}
      style={
        url
          ? atlas
            ? { backgroundImage: `url(${url})`, backgroundSize: "260%", backgroundPosition: "50% 30%" }
            : { backgroundImage: `url(${url})`, backgroundSize: "cover", backgroundPosition: "center" }
          : undefined
      }
    />
  );
}

/**
 * "Twins on this device": switch between people, scan someone new, open the
 * demo, or delete a twin (record, saved looks and any cloud copy).
 */
export function TwinsSheet() {
  const open = useStudio((s) => s.panel === "twins");
  const openPanel = useStudio((s) => s.openPanel);
  const asset = useStudio((s) => s.asset);
  const router = useRouter();
  const [twins, setTwins] = useState<InstantTwinRecord[] | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const images = useTwinImages(twins);

  useEffect(() => {
    if (open) avatarVault.list().then(setTwins, () => setTwins([]));
    else setConfirm(null);
  }, [open]);

  const go = (href: string) => {
    openPanel("none");
    // Inside Telegram stay in the Mini App shell; on the web a full load resets the studio.
    if (inTelegram()) router.push(href);
    else window.location.assign(href);
  };
  const tg = inTelegram();
  const openTwin = (id: string) => {
    setActiveAvatarId(id);
    go(tg ? `/tg?avatar=${id}` : `/studio?avatar=${id}`);
  };
  const scanNew = () => go(tg ? "/tg?create=1" : "/create");
  const openDemo = () => go(tg ? "/tg?demo=1" : "/studio?demo=1");

  const remove = async (id: string) => {
    setBusy(true);
    try {
      const next = await deleteTwin(id);
      setConfirm(null);
      if (asset?.id === id) {
        if (next) openTwin(next.id);
        else scanNew();
        return;
      }
      setTwins(await avatarVault.list());
    } finally {
      setBusy(false);
    }
  };

  const date = (t: number) => new Date(t).toLocaleDateString(undefined, { day: "numeric", month: "short" }) + ", " + new Date(t).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <Sheet open={open} onClose={() => openPanel("none")} label="Your twins">
      <h2 className="font-display text-[22px] font-semibold">Your twins</h2>
      <p className="mt-1 text-[13px] leading-5 text-mist-400">Saved on this device only. Scan as many people as you like.</p>

      <Button variant="solid" onClick={scanNew} className="mt-5 h-12 w-full justify-center gap-2 text-[15px]">
        <IconCamera size={18} /> Scan a new person
      </Button>

      <ul className="mt-5 max-h-[46vh] space-y-2 overflow-y-auto">
        {twins === null && <li className="py-6 text-center text-[13px] text-mist-500">Loading…</li>}
        {twins?.length === 0 && <li className="py-4 text-center text-[13px] text-mist-500">No scans yet.</li>}
        {twins?.map((t, i) => {
          const active = asset?.id === t.id;
          const img = images.get(t.id);
          return (
            <li key={t.id} className={cn("rounded-2xl border p-2.5 transition-colors", active ? "border-white/15 bg-white/[0.06]" : "border-white/[0.06] bg-white/[0.02]")}>
              {confirm === t.id ? (
                <div className="flex items-center gap-3">
                  <TwinAvatar url={img?.url} atlas={img?.atlas} className="size-12 rounded-xl opacity-60" />
                  <p className="min-w-0 flex-1 text-[14px] leading-5 text-mist-100">
                    Delete this twin?
                    <span className="block text-[12px] text-mist-400">It can&apos;t be undone.</span>
                  </p>
                  <Button variant="glass" size="sm" onClick={() => setConfirm(null)} disabled={busy}>
                    Cancel
                  </Button>
                  <button
                    onClick={() => remove(t.id)}
                    disabled={busy}
                    className="h-9 rounded-full bg-err-400/90 px-4 text-[13px] font-semibold text-ink-950 disabled:opacity-60"
                  >
                    {busy ? "Deleting…" : "Delete"}
                  </button>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <button onClick={() => (active ? openPanel("none") : openTwin(t.id))} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    <TwinAvatar url={img?.url} atlas={img?.atlas} className="size-12 rounded-xl" />
                    <span className="min-w-0">
                      <span className="block truncate text-[15px] font-medium text-mist-50">
                        {t.name === "My twin" && twins.length > 1 ? `Twin ${twins.length - i}` : t.name}
                      </span>
                      <span className="block text-[12px] text-mist-400">{active ? "Open now" : `Scanned ${date(t.createdAt)}`}</span>
                    </span>
                    {!active && <IconChevron size={16} className="ml-auto shrink-0 text-mist-500" />}
                  </button>
                  <button
                    onClick={() => setConfirm(t.id)}
                    className="grid size-9 shrink-0 place-items-center rounded-full text-mist-400 hover:bg-white/[0.06] hover:text-err-400"
                    aria-label="Delete twin"
                    title="Delete twin"
                  >
                    <IconTrash size={17} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <button onClick={openDemo} className="mt-4 w-full text-center text-[13px] text-mist-400 underline-offset-4 hover:text-mist-100 hover:underline">
        {asset?.kind === "template" ? "You're looking at the demo twin" : "Try the demo twin"}
      </button>
    </Sheet>
  );
}
