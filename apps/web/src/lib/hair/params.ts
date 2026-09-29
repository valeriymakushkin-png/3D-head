import type { HairColorId, HairstyleId, BeardId, Look } from "@/lib/avatar/look";

/**
 * Physical, style-independent parameters of the procedural hair generator.
 * Lengths are metres. Heights (`fadeLow`, `topZone`, …) are expressed as a
 * normalised scalp height h ∈ [0,1]: 0 at the local hairline, 1 at the crown,
 * which makes one preset fit every head shape.
 */
export type HairFlow = "forward" | "back" | "up" | "side" | "middle" | "down";

export interface HairParams {
  topLength: number;
  frontLength: number;
  sideLength: number;
  backLength: number;
  napeLength: number;
  /** 0 = no fade, 1 = skin fade. */
  fade: number;
  fadeLow: number;
  fadeHigh: number;
  /** How much the fade also applies to the back (0 for mullets). */
  backFade: number;
  topZone: number;
  /** Softness of the top/sides transition. Tiny = disconnected undercut. */
  topBlend: number;
  flow: HairFlow;
  /** Side part position in [-1, 1] (fraction of half head width). */
  partX: number;
  /** Front lift for quiffs / pompadours. */
  frontLift: number;
  lift: number;
  volume: number;
  curl: number;
  /** Curl frequency in turns per metre. */
  curlFreq: number;
  messiness: number;
  clump: number;
  gravity: number;
  density: number;
  recession: number;
  /** Ribbon width at the root, metres. */
  strandWidth: number;
}

const BASE: HairParams = {
  topLength: 0.05,
  frontLength: 0.05,
  sideLength: 0.02,
  backLength: 0.02,
  napeLength: 0.01,
  fade: 0,
  fadeLow: 0.05,
  fadeHigh: 0.4,
  backFade: 1,
  topZone: 0.5,
  topBlend: 0.2,
  flow: "forward",
  partX: 0,
  frontLift: 0,
  lift: 0.3,
  volume: 0.35,
  curl: 0.1,
  curlFreq: 55,
  messiness: 0.25,
  clump: 0.45,
  gravity: 0.3,
  density: 1,
  recession: 0,
  strandWidth: 0.00042,
};

export const HAIRSTYLE_PRESETS: Record<Exclude<HairstyleId, "natural">, HairParams> = {
  buzz_cut: {
    ...BASE,
    topLength: 0.0065,
    frontLength: 0.006,
    sideLength: 0.0045,
    backLength: 0.0045,
    napeLength: 0.003,
    topZone: 0.4,
    topBlend: 0.5,
    flow: "up",
    lift: 0.55,
    volume: 0.02,
    curl: 0,
    messiness: 0.25,
    clump: 0.05,
    gravity: 0,
    strandWidth: 0.00032,
  },
  fade: {
    ...BASE,
    topLength: 0.035,
    frontLength: 0.04,
    sideLength: 0.011,
    backLength: 0.011,
    napeLength: 0.003,
    fade: 1,
    fadeLow: 0.04,
    fadeHigh: 0.46,
    topZone: 0.56,
    topBlend: 0.12,
    flow: "forward",
    lift: 0.45,
    volume: 0.35,
    curl: 0.15,
    messiness: 0.35,
    clump: 0.35,
    gravity: 0.1,
  },
  taper_fade: {
    ...BASE,
    topLength: 0.05,
    frontLength: 0.058,
    sideLength: 0.016,
    backLength: 0.014,
    napeLength: 0.004,
    fade: 0.75,
    fadeLow: 0,
    fadeHigh: 0.22,
    topZone: 0.55,
    topBlend: 0.2,
    flow: "side",
    partX: -0.38,
    lift: 0.38,
    volume: 0.42,
    curl: 0.08,
    messiness: 0.18,
    clump: 0.45,
    gravity: 0.12,
  },
  textured_crop: {
    ...BASE,
    topLength: 0.04,
    frontLength: 0.03,
    sideLength: 0.01,
    backLength: 0.01,
    napeLength: 0.003,
    fade: 0.9,
    fadeLow: 0.05,
    fadeHigh: 0.42,
    topZone: 0.5,
    topBlend: 0.1,
    flow: "forward",
    lift: 0.55,
    volume: 0.45,
    curl: 0.35,
    messiness: 0.62,
    clump: 0.55,
    gravity: 0.08,
  },
  french_crop: {
    ...BASE,
    topLength: 0.034,
    frontLength: 0.036,
    sideLength: 0.012,
    backLength: 0.012,
    napeLength: 0.004,
    fade: 0.5,
    fadeLow: 0.05,
    fadeHigh: 0.36,
    topZone: 0.52,
    topBlend: 0.15,
    flow: "forward",
    lift: 0.22,
    volume: 0.22,
    curl: 0.05,
    messiness: 0.18,
    clump: 0.3,
    gravity: 0.2,
  },
  curtains: {
    ...BASE,
    topLength: 0.11,
    frontLength: 0.13,
    sideLength: 0.06,
    backLength: 0.065,
    napeLength: 0.045,
    topZone: 0.42,
    topBlend: 0.3,
    flow: "middle",
    lift: 0.22,
    volume: 0.5,
    curl: 0.22,
    messiness: 0.3,
    clump: 0.6,
    gravity: 0.6,
  },
  quiff: {
    ...BASE,
    topLength: 0.07,
    frontLength: 0.09,
    sideLength: 0.014,
    backLength: 0.015,
    napeLength: 0.004,
    fade: 0.6,
    fadeLow: 0.05,
    fadeHigh: 0.4,
    topZone: 0.5,
    topBlend: 0.12,
    flow: "back",
    frontLift: 0.85,
    lift: 0.5,
    volume: 0.7,
    curl: 0.1,
    messiness: 0.35,
    clump: 0.5,
    gravity: 0.08,
  },
  pompadour: {
    ...BASE,
    topLength: 0.09,
    frontLength: 0.115,
    sideLength: 0.018,
    backLength: 0.02,
    napeLength: 0.006,
    fade: 0.4,
    fadeLow: 0.1,
    fadeHigh: 0.45,
    topZone: 0.5,
    topBlend: 0.15,
    flow: "back",
    frontLift: 1,
    lift: 0.55,
    volume: 0.85,
    curl: 0.04,
    messiness: 0.08,
    clump: 0.72,
    gravity: 0.05,
  },
  undercut: {
    ...BASE,
    topLength: 0.1,
    frontLength: 0.12,
    sideLength: 0.003,
    backLength: 0.003,
    napeLength: 0.002,
    topZone: 0.6,
    topBlend: 0.03,
    flow: "back",
    frontLift: 0.3,
    lift: 0.3,
    volume: 0.45,
    curl: 0.05,
    messiness: 0.15,
    clump: 0.65,
    gravity: 0.25,
  },
  long: {
    ...BASE,
    topLength: 0.3,
    frontLength: 0.26,
    sideLength: 0.3,
    backLength: 0.34,
    napeLength: 0.3,
    topZone: 0.35,
    topBlend: 0.4,
    flow: "middle",
    lift: 0.1,
    volume: 0.45,
    curl: 0.2,
    messiness: 0.22,
    clump: 0.68,
    gravity: 1,
  },
  mullet: {
    ...BASE,
    topLength: 0.06,
    frontLength: 0.05,
    sideLength: 0.02,
    backLength: 0.17,
    napeLength: 0.2,
    fade: 0.55,
    fadeLow: 0,
    fadeHigh: 0.35,
    backFade: 0,
    topZone: 0.5,
    topBlend: 0.2,
    flow: "forward",
    lift: 0.35,
    volume: 0.5,
    curl: 0.35,
    messiness: 0.45,
    clump: 0.55,
    gravity: 0.8,
  },
};

/**
 * The user's own hair as estimated by reconstruction (see recon/analyze.ts
 * and services/reconstruct/twinme_recon/hair.py). Stored on the avatar rig.
 */
export interface NaturalHair {
  /** Closest preset — used as the base shape. */
  base: Exclude<HairstyleId, "natural">;
  /** Multiplier applied to the preset lengths. */
  lengthScale: number;
  volume: number;
  curl: number;
  /** Detected colour (sRGB hex). */
  color: string;
  density: number;
}

export const DEFAULT_NATURAL_HAIR: NaturalHair = {
  base: "buzz_cut",
  lengthScale: 0.8,
  volume: 0.05,
  curl: 0,
  color: "#2a211b",
  density: 0.9,
};

export function lengthScaleFromSlider(v: number): number {
  return Math.pow(2, (v - 0.5) * 2.4);
}

export function sliderFromLengthScale(s: number): number {
  return Math.min(1, Math.max(0, Math.log2(s) / 2.4 + 0.5));
}

/** Default slider values shown in the fine-tune panel for a style. */
export function styleSliderDefaults(style: HairstyleId, natural: NaturalHair) {
  const p = style === "natural" ? HAIRSTYLE_PRESETS[natural.base] : HAIRSTYLE_PRESETS[style];
  return {
    length: style === "natural" ? sliderFromLengthScale(natural.lengthScale) : 0.5,
    volume: style === "natural" ? natural.volume : p.volume,
    texture: Math.min(1, (style === "natural" ? natural.curl : p.curl) / 0.9),
  };
}

/** Resolves a Look's hair section into generator parameters. */
export function resolveHairParams(look: Look["hair"], natural: NaturalHair): HairParams {
  const isNatural = look.style === "natural";
  const preset = HAIRSTYLE_PRESETS[look.style === "natural" ? natural.base : look.style];
  const p: HairParams = { ...preset };

  let scale = isNatural ? natural.lengthScale : 1;
  if (look.length !== null) scale = lengthScaleFromSlider(look.length);
  p.topLength *= scale;
  p.frontLength *= scale;
  p.backLength *= scale;
  p.napeLength *= Math.sqrt(scale);
  p.sideLength *= Math.sqrt(scale);

  if (isNatural) {
    p.volume = natural.volume;
    p.curl = natural.curl;
    p.density = natural.density;
  }
  if (look.volume !== null) p.volume = look.volume;
  if (look.texture !== null) {
    p.curl = look.texture * 0.9;
    p.messiness = 0.12 + look.texture * 0.6;
  }
  p.density *= look.density;
  p.recession = look.recession;
  // Long hair falls; very short hair stands.
  const maxLen = Math.max(p.topLength, p.backLength, p.sideLength);
  if (maxLen < 0.012) p.gravity = 0;
  return p;
}

// ---------------------------------------------------------------------------
// Colour
// ---------------------------------------------------------------------------

export interface HairColorSpec {
  root: string;
  tip: string;
  /** Optional second strand colour (salt & pepper), with its share. */
  alt?: { color: string; share: number };
  /** Specular strength multiplier — light hair is shinier. */
  shine: number;
}

export const HAIR_COLORS: Record<Exclude<HairColorId, "natural">, HairColorSpec> = {
  black: { root: "#0a0807", tip: "#1d1713", shine: 0.9 },
  dark_brown: { root: "#1c110a", tip: "#3d2718", shine: 0.85 },
  brown: { root: "#35200f", tip: "#6e4629", shine: 0.8 },
  blonde: { root: "#6a553b", tip: "#b89f76", shine: 0.6 },
  platinum: { root: "#8a8479", tip: "#dcd8cf", shine: 0.5 },
  ginger: { root: "#5a2511", tip: "#a4532a", shine: 0.7 },
  grey: { root: "#4c4844", tip: "#a9a59f", alt: { color: "#1f1c1a", share: 0.3 }, shine: 0.6 },
};

export function resolveHairColor(look: Look["hair"], natural: NaturalHair): HairColorSpec {
  if (look.customColor) return fromSingleColor(look.customColor);
  if (look.color === "natural") return fromSingleColor(natural.color);
  return HAIR_COLORS[look.color];
}

function fromSingleColor(hexColor: string): HairColorSpec {
  const [r, g, b] = hexToRgb(hexColor);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return {
    root: rgbToHex(r * 0.72, g * 0.72, b * 0.72),
    tip: rgbToHex(r * 1.18 + 6, g * 1.18 + 5, b * 1.15 + 3),
    shine: lum > 140 ? 0.6 : 0.85,
  };
}

export function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

// ---------------------------------------------------------------------------
// Beard
// ---------------------------------------------------------------------------

export type BeardRegion = "full" | "goatee";

export interface BeardParams {
  region: BeardRegion;
  length: number;
  density: number;
  /** Skin darkening under the beard (stubble shadow). */
  shadow: number;
  curl: number;
  /** How far down the neck the beard extends, metres below the jaw. */
  neckDrop: number;
  strandWidth: number;
}

export const BEARD_PRESETS: Record<Exclude<BeardId, "clean">, BeardParams> = {
  stubble: { region: "full", length: 0.0022, density: 1, shadow: 0.55, curl: 0, neckDrop: 0.012, strandWidth: 0.00026 },
  short: { region: "full", length: 0.008, density: 1, shadow: 0.62, curl: 0.15, neckDrop: 0.018, strandWidth: 0.0003 },
  full: { region: "full", length: 0.026, density: 1, shadow: 0.7, curl: 0.35, neckDrop: 0.028, strandWidth: 0.00034 },
  goatee: { region: "goatee", length: 0.011, density: 1, shadow: 0.5, curl: 0.15, neckDrop: 0, strandWidth: 0.0003 },
};

export function resolveBeardParams(look: Look["beard"]): BeardParams | null {
  if (look.style === "clean") return null;
  const p = { ...BEARD_PRESETS[look.style] };
  if (look.length !== null) p.length *= lengthScaleFromSlider(look.length);
  return p;
}
