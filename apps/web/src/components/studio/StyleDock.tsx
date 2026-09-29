"use client";

import { AnimatePresence, LayoutGroup, motion } from "framer-motion";
import { useEffect, useMemo, useRef, useState } from "react";
import { type CatalogItem, CATEGORY_LABELS, catalogFor, thumbKey } from "@/lib/avatar/catalog";
import { type Look, applyLookPatch } from "@/lib/avatar/look";
import { useThumbs } from "@/lib/engine/thumbnails";
import { HAIR_COLORS, lengthScaleFromSlider, styleSliderDefaults } from "@/lib/hair/params";
import { cn } from "@/lib/cn";
import { IconChevron } from "@/components/ui/icons";
import { Slider, easeOut, spring } from "@/components/ui/primitives";
import { CATEGORIES, type Category, useStudio } from "@/store/studio";

/** Base look for a thumbnail: only the dimensions the card depends on. */
function thumbBase(look: Look, category: Category): Look {
  return {
    ...look,
    glasses: category === "glasses" ? look.glasses : { style: "none", tint: null },
    accessories: category === "accessories" ? look.accessories : [],
    skin: category === "skin" ? look.skin : { tone: "natural", complexion: 0 },
  };
}

export function StyleDock({ compact = false }: { compact?: boolean }) {
  const asset = useStudio((s) => s.asset);
  const look = useStudio((s) => s.look);
  const category = useStudio((s) => s.category);
  const setCategory = useStudio((s) => s.setCategory);
  const applyPatch = useStudio((s) => s.applyPatch);
  const urls = useThumbs((s) => s.urls);
  const [tune, setTune] = useState(!compact);
  useEffect(() => setTune(!compact), [compact]);

  const items = useMemo(() => catalogFor(category, asset?.natural.color ?? "#2a211b"), [category, asset]);

  useEffect(() => {
    if (!asset) return;
    const base = thumbBase(look, category);
    const jobs = items
      .filter((i) => !i.swatch)
      .map((i) => ({ key: thumbKey(asset.id, category, i, look), look: applyLookPatch(base, (i.preview ?? i.patch)(base)) }));
    useThumbs.getState().enqueue(jobs);
  }, [items, look, asset, category]);

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.7, ease: easeOut, delay: 0.15 }}
      className="pointer-events-auto flex w-full flex-col gap-3"
    >
      <div className="glass rounded-[28px] px-2 pb-3 pt-2 md:px-3">
        <div className="flex items-center gap-2">
        <LayoutGroup id="cats">
          <div className="no-scrollbar flex flex-1 gap-1 overflow-x-auto px-1 pb-2" role="tablist" aria-label="Appearance categories">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                role="tab"
                aria-selected={category === c}
                onClick={() => setCategory(c)}
                className={cn(
                  "relative shrink-0 rounded-full px-4 py-2 text-[13px] font-medium transition-colors",
                  category === c ? "text-mist-50" : "text-mist-400 hover:text-mist-200",
                )}
              >
                {category === c && (
                  <motion.span layoutId="cat-pill" transition={spring} className="absolute inset-0 rounded-full bg-white/[0.09] ring-1 ring-white/10" />
                )}
                <span className="relative">{CATEGORY_LABELS[c]}</span>
              </button>
            ))}
          </div>
        </LayoutGroup>
          <button
            onClick={() => setTune((t) => !t)}
            className={cn("mb-2 mr-1 shrink-0 rounded-full px-3 py-1.5 text-[12px] font-medium transition-colors", tune ? "bg-white/[0.08] text-mist-100" : "text-mist-400 hover:text-mist-200")}
            aria-expanded={tune}
          >
            Adjust
          </button>
        </div>
        <AnimatePresence initial={false}>{tune && <FineTune category={category} />}</AnimatePresence>
        <Carousel key={category} items={items} look={look} compact={compact} urls={urls} assetId={asset?.id ?? ""} category={category} onPick={(i) => applyPatch(i.patch(look))} />
      </div>
    </motion.div>
  );
}

function Carousel({
  items,
  look,
  urls,
  assetId,
  category,
  onPick,
  compact,
}: {
  items: CatalogItem[];
  look: Look;
  urls: Record<string, string>;
  assetId: string;
  category: Category;
  onPick: (i: CatalogItem) => void;
  compact: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ l: false, r: true });
  const onScroll = () => {
    const el = ref.current;
    if (!el) return;
    setEdge({ l: el.scrollLeft > 8, r: el.scrollLeft + el.clientWidth < el.scrollWidth - 8 });
  };
  useEffect(onScroll, [items]);
  const scrollBy = (d: number) => ref.current?.scrollBy({ left: d * (ref.current.clientWidth * 0.7), behavior: "smooth" });
  const w = compact ? 76 : 96;
  const h = compact ? 94 : 118;

  return (
    <div className="relative">
      <div ref={ref} onScroll={onScroll} className="no-scrollbar flex snap-x snap-mandatory gap-2.5 overflow-x-auto scroll-px-2 px-1">
        {items.map((item, i) => {
          const active = item.isActive(look);
          const url = item.swatch ? null : urls[thumbKey(assetId, category, item, look)];
          return (
            <motion.button
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.025, duration: 0.4, ease: easeOut }}
              onClick={() => onPick(item)}
              className="group shrink-0 snap-start text-left"
              style={{ width: w }}
              aria-pressed={active}
              title={item.hint}
            >
              <div
                className={cn(
                  "relative overflow-hidden rounded-[18px] bg-ink-800 transition-[transform,box-shadow] duration-300 group-hover:-translate-y-0.5",
                  active ? "ring-2 ring-mist-50 ring-offset-2 ring-offset-ink-900" : "ring-1 ring-white/[0.06]",
                )}
                style={{ height: item.swatch ? w : h }}
              >
                {item.swatch ? (
                  <div className="absolute inset-2 rounded-full shadow-[inset_0_2px_6px_rgba(255,255,255,0.2),inset_0_-8px_16px_rgba(0,0,0,0.35)]" style={{ background: item.swatch }} />
                ) : url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <motion.img initial={{ opacity: 0 }} animate={{ opacity: 1 }} src={url} alt="" className="absolute inset-0 size-full object-cover" draggable={false} />
                ) : (
                  <div className="absolute inset-0 animate-shimmer bg-[linear-gradient(100deg,transparent_30%,rgba(255,255,255,0.05)_50%,transparent_70%)] bg-[length:200%_100%]" />
                )}
              </div>
              <div className={cn("mt-1.5 truncate px-0.5 text-[12px] font-medium", active ? "text-mist-50" : "text-mist-300")}>{item.label}</div>
            </motion.button>
          );
        })}
        {category === "color" && <CustomColor look={look} size={w} />}
      </div>
      <AnimatePresence>
        {edge.l && !compact && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => scrollBy(-1)} className="glass absolute left-1 top-[40%] grid size-8 -translate-y-1/2 place-items-center rounded-full" aria-label="Scroll left">
            <IconChevron size={16} className="rotate-180" />
          </motion.button>
        )}
        {edge.r && !compact && (
          <motion.button initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => scrollBy(1)} className="glass absolute right-1 top-[40%] grid size-8 -translate-y-1/2 place-items-center rounded-full" aria-label="Scroll right">
            <IconChevron size={16} />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

function CustomColor({ look, size }: { look: Look; size: number }) {
  const applyPatch = useStudio((s) => s.applyPatch);
  const value = look.hair.customColor ?? "#6b4a2e";
  return (
    <label className="group shrink-0 snap-start cursor-pointer" style={{ width: size }}>
      <div className={cn("relative overflow-hidden rounded-[18px] bg-ink-800", look.hair.customColor ? "ring-2 ring-mist-50 ring-offset-2 ring-offset-ink-900" : "ring-1 ring-white/[0.06]")} style={{ height: size }}>
        <div className="absolute inset-2 rounded-full bg-[conic-gradient(from_0deg,#d9b27c,#6b2a12,#1d1510,#b9b3a8,#c46a3a,#d9b27c)] opacity-90" />
        <input type="color" value={value} onChange={(e) => applyPatch({ hair: { customColor: e.target.value } })} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Custom hair colour" />
      </div>
      <div className="mt-1.5 px-0.5 text-[12px] font-medium text-mist-300">Custom</div>
    </label>
  );
}

/** Contextual fine-tuning, inline in the dock. */
function FineTune({ category }: { category: Category }) {
  const asset = useStudio((s) => s.asset);
  const look = useStudio((s) => s.look);
  const dragPatch = useStudio((s) => s.dragPatch);
  const commitDrag = useStudio((s) => s.commitDrag);
  const applyPatch = useStudio((s) => s.applyPatch);
  const [advanced, setAdvanced] = useState(false);
  if (!asset) return null;
  const d = styleSliderDefaults(look.hair.style, asset.natural);

  let body: React.ReactNode = null;
  if (category === "hair" || category === "color") {
    body = (
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:gap-6">
        <div className="flex shrink-0 items-center gap-2">
          {(["natural", "black", "dark_brown", "brown", "blonde", "platinum", "ginger", "grey"] as const).map((c) => (
            <button
              key={c}
              onClick={() => applyPatch({ hair: { color: c } })}
              aria-label={`${c.replace("_", " ")} hair`}
              className={cn(
                "size-6 rounded-full shadow-[inset_0_1px_2px_rgba(255,255,255,0.25)] transition-transform hover:scale-110 md:size-7",
                look.hair.color === c && !look.hair.customColor && "ring-2 ring-mist-50 ring-offset-2 ring-offset-[#15161a]",
              )}
              style={{ background: c === "natural" ? asset.natural.color : `linear-gradient(160deg, ${HAIR_COLORS[c].tip}, ${HAIR_COLORS[c].root})` }}
            />
          ))}
        </div>
        <div className="grid flex-1 gap-x-6 gap-y-1 md:grid-cols-3">
          <Slider label="Length" value={look.hair.length ?? d.length} onChange={(v) => dragPatch({ hair: { length: v } })} onCommit={commitDrag} />
          <Slider label="Volume" value={look.hair.volume ?? d.volume} onChange={(v) => dragPatch({ hair: { volume: v } })} onCommit={commitDrag} />
          <Slider label="Texture" value={look.hair.texture ?? d.texture} onChange={(v) => dragPatch({ hair: { texture: v } })} onCommit={commitDrag} />
          {advanced && (
            <>
              <Slider label="Density" value={look.hair.density} onChange={(v) => dragPatch({ hair: { density: Math.max(0.05, v) } })} onCommit={commitDrag} />
              <Slider label="Hairline" value={look.hair.recession} onChange={(v) => dragPatch({ hair: { recession: v } })} onCommit={commitDrag} />
            </>
          )}
        </div>
        <button onClick={() => setAdvanced((a) => !a)} className="shrink-0 self-start text-[12px] text-mist-500 hover:text-mist-200 lg:self-center" title={`≈ ${Math.round(lengthScaleFromSlider(look.hair.length ?? d.length) * 100)}% of the cut's designed length`}>
          {advanced ? "Less" : "Density"}
        </button>
      </div>
    );
  } else if (category === "beard" && look.beard.style !== "clean") {
    body = <Slider className="max-w-md" label="Length" value={look.beard.length ?? 0.5} onChange={(v) => dragPatch({ beard: { length: v } })} onCommit={commitDrag} />;
  } else if (category === "glasses" && look.glasses.style !== "none") {
    body = (
      <Slider
        className="max-w-md"
        label="Lens tint"
        value={look.glasses.tint ?? (look.glasses.style === "aviator" ? 0.82 : look.glasses.style === "luxury" ? 0.78 : 0)}
        onChange={(v) => dragPatch({ glasses: { tint: v } })}
        onCommit={commitDrag}
      />
    );
  } else if (category === "skin") {
    body = <Slider className="max-w-md" label="Complexion" value={look.skin.complexion} onChange={(v) => dragPatch({ skin: { complexion: v } })} onCommit={commitDrag} />;
  }
  if (!body) return null;
  return (
    <motion.div
      initial={{ height: 0, opacity: 0 }}
      animate={{ height: "auto", opacity: 1 }}
      exit={{ height: 0, opacity: 0 }}
      transition={{ duration: 0.35, ease: easeOut }}
      className="overflow-hidden"
    >
      <div className="mx-1 mb-3 rounded-[20px] bg-black/20 px-4 py-3">{body}</div>
    </motion.div>
  );
}
