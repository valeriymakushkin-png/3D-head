import { z } from "zod";

/**
 * The Look is the single source of truth for an avatar's appearance.
 * It is small, serialisable and validated at every boundary: the studio
 * store, the AI Stylist tool calls, the transformations table (jsonb) and
 * shared links all speak this schema.
 */

export const HAIRSTYLE_IDS = [
  "natural",
  "buzz_cut",
  "fade",
  "taper_fade",
  "textured_crop",
  "french_crop",
  "curtains",
  "quiff",
  "pompadour",
  "undercut",
  "long",
  "mullet",
] as const;

export const BEARD_IDS = ["clean", "stubble", "short", "full", "goatee"] as const;

export const HAIR_COLOR_IDS = [
  "natural",
  "black",
  "dark_brown",
  "brown",
  "blonde",
  "platinum",
  "ginger",
  "grey",
] as const;

export const GLASSES_IDS = ["none", "aviator", "round", "rectangle", "luxury", "minimal"] as const;

export const SKIN_TONE_IDS = ["natural", "tanned"] as const;

export const ACCESSORY_IDS = ["stud_earrings", "hoop_earring", "chain", "signet_chain"] as const;

export const HairstyleId = z.enum(HAIRSTYLE_IDS);
export const BeardId = z.enum(BEARD_IDS);
export const HairColorId = z.enum(HAIR_COLOR_IDS);
export const GlassesId = z.enum(GLASSES_IDS);
export const SkinToneId = z.enum(SKIN_TONE_IDS);
export const AccessoryId = z.enum(ACCESSORY_IDS);

export type HairstyleId = z.infer<typeof HairstyleId>;
export type BeardId = z.infer<typeof BeardId>;
export type HairColorId = z.infer<typeof HairColorId>;
export type GlassesId = z.infer<typeof GlassesId>;
export type SkinToneId = z.infer<typeof SkinToneId>;
export type AccessoryId = z.infer<typeof AccessoryId>;

const unit = z.number().min(0).max(1);
const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/);

export const LookSchema = z.object({
  hair: z.object({
    style: HairstyleId,
    color: HairColorId,
    /** Optional custom colour; overrides `color` when set. */
    customColor: hex.nullable().default(null),
    /** Fine-tune sliders. `null` means "use the style's default". */
    length: unit.nullable().default(null),
    volume: unit.nullable().default(null),
    texture: unit.nullable().default(null),
    /** Hair density 0..1 — used by the clinic flow to simulate thinning/transplants. */
    density: unit.default(1),
    /** Temple recession 0..1 (clinic / thinning visualisation). */
    recession: unit.default(0),
  }),
  beard: z.object({
    style: BeardId,
    /** 0..1 — relative to the style default. */
    length: unit.nullable().default(null),
  }),
  glasses: z.object({
    style: GlassesId,
    /** Sun lens tint 0 (clear) .. 1 (dark). `null` = style default. */
    tint: unit.nullable().default(null),
  }),
  skin: z.object({
    tone: SkinToneId,
    /** 0 = as captured, 1 = maximum complexion improvement. */
    complexion: unit.default(0),
  }),
  accessories: z.array(AccessoryId).max(4).default([]),
});

export type Look = z.infer<typeof LookSchema>;

/**
 * A partial look used by AI tool calls and quick actions. Deliberately has
 * NO defaults: a patch must only carry what it changes, so an AI-applied
 * haircut can never silently reset the user's density or colour.
 */
export const LookPatchSchema = z
  .object({
    hair: z
      .object({
        style: HairstyleId,
        color: HairColorId,
        customColor: hex.nullable(),
        length: unit.nullable(),
        volume: unit.nullable(),
        texture: unit.nullable(),
        density: unit,
        recession: unit,
      })
      .partial()
      .strict(),
    beard: z.object({ style: BeardId, length: unit.nullable() }).partial().strict(),
    glasses: z.object({ style: GlassesId, tint: unit.nullable() }).partial().strict(),
    skin: z.object({ tone: SkinToneId, complexion: unit }).partial().strict(),
    accessories: z.array(AccessoryId).max(4),
  })
  .partial()
  .strict();
export type LookPatch = z.infer<typeof LookPatchSchema>;

export const DEFAULT_LOOK: Look = {
  hair: {
    style: "natural",
    color: "natural",
    customColor: null,
    length: null,
    volume: null,
    texture: null,
    density: 1,
    recession: 0,
  },
  beard: { style: "clean", length: null },
  glasses: { style: "none", tint: null },
  skin: { tone: "natural", complexion: 0 },
  accessories: [],
};

/**
 * Applies a patch. Switching hairstyle resets the fine-tune sliders so a new
 * cut always starts from its designed proportions, unless the patch sets them.
 */
export function applyLookPatch(look: Look, patch: LookPatch): Look {
  const next: Look = structuredClone(look);
  if (patch.hair) {
    const styleChanged = patch.hair.style !== undefined && patch.hair.style !== look.hair.style;
    if (styleChanged) {
      next.hair.length = null;
      next.hair.volume = null;
      next.hair.texture = null;
    }
    Object.assign(next.hair, stripUndefined(patch.hair));
    if (patch.hair.color !== undefined && patch.hair.customColor === undefined) {
      next.hair.customColor = null;
    }
  }
  if (patch.beard) {
    const styleChanged = patch.beard.style !== undefined && patch.beard.style !== look.beard.style;
    if (styleChanged) next.beard.length = null;
    Object.assign(next.beard, stripUndefined(patch.beard));
  }
  if (patch.glasses) Object.assign(next.glasses, stripUndefined(patch.glasses));
  if (patch.skin) Object.assign(next.skin, stripUndefined(patch.skin));
  if (patch.accessories) next.accessories = [...new Set(patch.accessories)];
  return LookSchema.parse(next);
}

function stripUndefined<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}

export function looksEqual(a: Look, b: Look): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Lists the dimensions that differ, for "Applied: …" chips and analytics. */
export function diffLooks(a: Look, b: Look): Array<"hair" | "beard" | "glasses" | "skin" | "accessories"> {
  const keys = ["hair", "beard", "glasses", "skin", "accessories"] as const;
  return keys.filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
}
