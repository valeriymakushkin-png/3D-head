import type { Category } from "@/store/studio";
import { HAIR_COLORS } from "@/lib/hair/params";
import type { AccessoryId, HairColorId, Look, LookPatch } from "@/lib/avatar/look";

export interface CatalogItem {
  id: string;
  label: string;
  hint?: string;
  patch: (look: Look) => LookPatch;
  /** Patch used for the thumbnail (defaults to `patch`; toggles preview their ON state). */
  preview?: (look: Look) => LookPatch;
  isActive: (look: Look) => boolean;
  /** Solid swatch instead of a rendered thumbnail. */
  swatch?: string;
  /** Which look dimensions the rendered thumbnail depends on (cache key). */
  thumbDeps: Array<"hair" | "color" | "beard" | "glasses" | "skin" | "accessories">;
}

const hairstyles: Array<[Look["hair"]["style"], string, string]> = [
  ["natural", "Your hair", "As captured"],
  ["buzz_cut", "Buzz Cut", "Clean, zero upkeep"],
  ["fade", "Fade", "Skin fade, short top"],
  ["taper_fade", "Taper Fade", "Low taper, side part"],
  ["textured_crop", "Textured Crop", "Messy texture, short fringe"],
  ["french_crop", "French Crop", "Blunt forward fringe"],
  ["curtains", "Curtains", "Middle part, 90s"],
  ["quiff", "Quiff", "Height at the front"],
  ["pompadour", "Pompadour", "Full volume, swept back"],
  ["undercut", "Undercut", "Disconnected sides"],
  ["long", "Long", "Shoulder length"],
  ["mullet", "Mullet", "Short front, long back"],
];

const beards: Array<[Look["beard"]["style"], string, string]> = [
  ["clean", "Clean Shave", "Smooth"],
  ["stubble", "Stubble", "3-day shadow"],
  ["short", "Short Beard", "Groomed, ~8 mm"],
  ["full", "Full Beard", "~25 mm"],
  ["goatee", "Goatee", "Circle beard"],
];

const colorLabels: Record<HairColorId, string> = {
  natural: "Natural",
  black: "Black",
  dark_brown: "Dark Brown",
  brown: "Brown",
  blonde: "Blonde",
  platinum: "Platinum",
  ginger: "Ginger",
  grey: "Grey",
};

const glasses: Array<[Look["glasses"]["style"], string, string]> = [
  ["none", "None", "Bare"],
  ["aviator", "Aviator", "Gold, G-15 lens"],
  ["round", "Round", "Antique gold wire"],
  ["rectangle", "Rectangle", "Matte acetate"],
  ["luxury", "Luxury", "Gloss acetate, gold rivets"],
  ["minimal", "Minimal", "Titanium, featherweight"],
];

const accessories: Array<[AccessoryId, string]> = [
  ["stud_earrings", "Studs"],
  ["hoop_earring", "Hoop"],
  ["chain", "Chain"],
  ["signet_chain", "Tag Chain"],
];

export function catalogFor(category: Category, naturalColor: string): CatalogItem[] {
  switch (category) {
    case "hair":
      return hairstyles.map(([id, label, hint]) => ({
        id,
        label,
        hint,
        patch: () => ({ hair: { style: id } }),
        isActive: (l) => l.hair.style === id,
        thumbDeps: ["color", "beard"],
      }));
    case "beard":
      return beards.map(([id, label, hint]) => ({
        id,
        label,
        hint,
        patch: () => ({ beard: { style: id } }),
        isActive: (l) => l.beard.style === id,
        thumbDeps: ["hair", "color"],
      }));
    case "color":
      return (Object.keys(colorLabels) as HairColorId[]).map((id) => ({
        id,
        label: colorLabels[id],
        patch: () => ({ hair: { color: id } }),
        isActive: (l) => l.hair.color === id && !l.hair.customColor,
        swatch: id === "natural" ? naturalColor : `linear-gradient(160deg, ${HAIR_COLORS[id].tip}, ${HAIR_COLORS[id].root})`,
        thumbDeps: ["hair"],
      }));
    case "glasses":
      return glasses.map(([id, label, hint]) => ({
        id,
        label,
        hint,
        patch: () => ({ glasses: { style: id, tint: null } }),
        isActive: (l) => l.glasses.style === id,
        thumbDeps: ["hair", "color", "beard"],
      }));
    case "skin":
      return [
        {
          id: "natural",
          label: "Natural",
          hint: "As captured",
          patch: () => ({ skin: { tone: "natural", complexion: 0 } }),
          isActive: (l) => l.skin.tone === "natural" && l.skin.complexion === 0,
          thumbDeps: ["hair", "color", "beard"],
        },
        {
          id: "tanned",
          label: "Tanned",
          hint: "Sun-kissed",
          patch: (l) => ({ skin: { tone: l.skin.tone === "tanned" ? "natural" : "tanned" } }),
          preview: () => ({ skin: { tone: "tanned" } }),
          isActive: (l) => l.skin.tone === "tanned",
          thumbDeps: ["hair", "color", "beard"],
        },
        {
          id: "improved",
          label: "Refined",
          hint: "Even tone, fewer blemishes",
          patch: (l) => ({ skin: { complexion: l.skin.complexion > 0 ? 0 : 0.65 } }),
          preview: () => ({ skin: { complexion: 0.65 } }),
          isActive: (l) => l.skin.complexion > 0,
          thumbDeps: ["hair", "color", "beard"],
        },
      ];
    case "accessories":
      return [
        {
          id: "none",
          label: "None",
          patch: () => ({ accessories: [] }),
          isActive: (l) => l.accessories.length === 0,
          thumbDeps: ["hair", "color", "beard"],
        },
        ...accessories.map(([id, label]) => ({
          id,
          label,
          patch: (l: Look): LookPatch => {
            const has = l.accessories.includes(id);
            let next = has ? l.accessories.filter((a) => a !== id) : [...l.accessories, id];
            // one neck piece at a time
            if (!has && (id === "chain" || id === "signet_chain")) next = next.filter((a) => a === id || (a !== "chain" && a !== "signet_chain"));
            if (!has && (id === "stud_earrings" || id === "hoop_earring")) next = next.filter((a) => a === id || (a !== "stud_earrings" && a !== "hoop_earring"));
            return { accessories: next };
          },
          preview: (): LookPatch => ({ accessories: [id] }),
          isActive: (l: Look) => l.accessories.includes(id),
          thumbDeps: ["hair", "color", "beard"] as CatalogItem["thumbDeps"],
        })),
      ];
  }
}

export const CATEGORY_LABELS: Record<Category, string> = {
  hair: "Hairstyles",
  beard: "Beard",
  color: "Color",
  glasses: "Glasses",
  skin: "Skin",
  accessories: "Accessories",
};

/** Cache key for a thumbnail given the dimensions it depends on. */
export function thumbKey(assetId: string, category: Category, item: CatalogItem, look: Look): string {
  const dep = (d: CatalogItem["thumbDeps"][number]) => {
    switch (d) {
      case "hair":
        return `${look.hair.style}:${look.hair.length}:${look.hair.volume}:${look.hair.texture}`;
      case "color":
        return `${look.hair.color}:${look.hair.customColor}`;
      case "beard":
        return `${look.beard.style}:${look.beard.length}`;
      case "glasses":
        return look.glasses.style;
      case "skin":
        return `${look.skin.tone}:${look.skin.complexion}`;
      case "accessories":
        return look.accessories.join(",");
    }
  };
  return [assetId, category, item.id, ...item.thumbDeps.map(dep)].join("|");
}
