"use client";

import type { BeardId } from "@/lib/avatar/look";
import type { NaturalHair } from "@/lib/hair/params";
import { HAIRSTYLE_PRESETS, rgbToHex } from "@/lib/hair/params";
import { LIPS_OUTER, FACE_OVAL } from "@/lib/head/rig";
import { SEG_CLASSES, getSegmenter } from "@/lib/recon/mediapipe";
import type { CaptureFrame } from "@/lib/recon/types";
import { rgbToLab, srgbToLinear } from "@/lib/style/analysis";

export interface SegmentedFrame {
  frame: CaptureFrame;
  /** Category per pixel at image resolution. */
  categories: Uint8Array;
  /** Feathered skin probability 0..255 at image resolution. */
  skinMask: Uint8Array;
  pixels: Uint8ClampedArray;
}

export async function segmentFrame(frame: CaptureFrame): Promise<SegmentedFrame> {
  const seg = await getSegmenter();
  const res = seg.segment(frame.image);
  const mask = res.categoryMask!;
  const mw = mask.width,
    mh = mask.height;
  const raw = mask.getAsUint8Array();
  const { width: W, height: H } = frame;
  const categories = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const my = Math.min(mh - 1, Math.floor((y * mh) / H));
    for (let x = 0; x < W; x++) categories[y * W + x] = raw[my * mw + Math.min(mw - 1, Math.floor((x * mw) / W))];
  }
  res.close();
  const skin = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const c = categories[i];
    skin[i] = c === SEG_CLASSES.faceSkin || c === SEG_CLASSES.bodySkin ? 255 : 0;
  }
  // Erode then feather so seams never land on hair/background edges.
  const r = Math.max(2, Math.round(Math.min(W, H) / 180));
  const eroded = erode(skin, W, H, r);
  const skinMask = boxBlur(boxBlur(eroded, W, H, r), W, H, r);
  const ctx = frame.image.getContext("2d", { willReadFrequently: true })!;
  const pixels = ctx.getImageData(0, 0, W, H).data;
  return { frame, categories, skinMask, pixels };
}

function erode(src: Uint8Array, W: number, H: number, r: number) {
  // separable min filter
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m = 255;
      for (let k = -r; k <= r; k++) m = Math.min(m, src[y * W + Math.min(W - 1, Math.max(0, x + k))]);
      tmp[y * W + x] = m;
    }
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      let m = 255;
      for (let k = -r; k <= r; k++) m = Math.min(m, tmp[Math.min(H - 1, Math.max(0, y + k)) * W + x]);
      out[y * W + x] = m;
    }
  return out;
}

function boxBlur(src: Uint8Array, W: number, H: number, r: number) {
  const tmp = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  const d = 2 * r + 1;
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += src[y * W + Math.min(W - 1, Math.max(0, k))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / d;
      acc += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let k = -r; k <= r; k++) acc += tmp[Math.min(H - 1, Math.max(0, k)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / d;
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}

const lx = (f: CaptureFrame, i: number) => f.landmarks[i * 3] * f.width;
const ly = (f: CaptureFrame, i: number) => f.landmarks[i * 3 + 1] * f.height;

function inPoly(x: number, y: number, pts: Array<[number, number]>) {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i];
    const [xj, yj] = pts[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-9) + xi) c = !c;
  }
  return c;
}

/**
 * Typical skin colour (sRGB): the per-channel median of skin pixels in small
 * patches across the face — forehead, nose, cheeks, chin — so neither flushed
 * cheeks nor a shadowed side decide the tone.
 */
export function meanSkinRgb(s: SegmentedFrame, landmarkIds = [151, 9, 108, 337, 6, 50, 280, 101, 330, 205, 425, 199]): [number, number, number] | null {
  const f = s.frame;
  const r = Math.max(3, Math.round((ly(f, 152) - ly(f, 10)) * 0.03));
  const R: number[] = [],
    G: number[] = [],
    B: number[] = [];
  for (const id of landmarkIds) {
    const cx = Math.round(lx(f, id)),
      cy = Math.round(ly(f, id));
    for (let y = cy - r; y <= cy + r; y += 2)
      for (let x = cx - r; x <= cx + r; x += 2) {
        if (x < 0 || y < 0 || x >= f.width || y >= f.height) continue;
        const i = y * f.width + x;
        if (s.categories[i] !== SEG_CLASSES.faceSkin) continue;
        R.push(s.pixels[i * 4]);
        G.push(s.pixels[i * 4 + 1]);
        B.push(s.pixels[i * 4 + 2]);
      }
  }
  if (R.length < 20) return null;
  const med = (v: number[]) => v.sort((a, b) => a - b)[v.length >> 1];
  return [med(R), med(G), med(B)];
}

export function linearOf(rgb: [number, number, number]): [number, number, number] {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

export interface HairBeardEstimate {
  natural: NaturalHair;
  lengthClass: "bald" | "buzz" | "short" | "medium" | "long";
  beard: { detected: BeardId; coverage: number };
  bakedBeard: number;
}

/**
 * Reads the user's current hair and facial hair from the segmentation of the
 * frontal (and side) frames, so the twin starts with *their* hair: preset,
 * length, volume, colour and density.
 */
export function estimateHairAndBeard(front: SegmentedFrame, sides: SegmentedFrame[]): HairBeardEstimate {
  const f = front.frame;
  const W = f.width,
    H = f.height;
  const fh = ly(f, 152) - ly(f, 10);
  const fw = lx(f, 454) - lx(f, 234);
  const cx = lx(f, 10);
  const topY = ly(f, 10);
  const isHair = (x: number, y: number) =>
    x >= 0 && y >= 0 && x < W && y < H && front.categories[Math.round(y) * W + Math.round(x)] === SEG_CLASSES.hair;
  const isSkin = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const c = front.categories[Math.round(y) * W + Math.round(x)];
    return c === SEG_CLASSES.faceSkin || c === SEG_CLASSES.bodySkin;
  };

  // Height of hair above landmark 10 in the central band.
  let hairTop = topY;
  for (let y = topY; y > Math.max(0, topY - fh * 0.8); y -= 2) {
    let hits = 0;
    for (let x = cx - fw * 0.15; x <= cx + fw * 0.15; x += 3) if (isHair(x, y)) hits++;
    if (hits > 2) hairTop = y;
  }
  // Segmentation noise (dark backgrounds, hats) can read as very tall hair; cap it.
  const hairHeight = Math.min(0.3, Math.max(0, (topY - hairTop) / fh));

  // Scalp coverage just above the forehead; bald scalps segment as skin.
  let hairPx = 0,
    skinPx = 0;
  for (let y = topY - fh * 0.3; y < topY - fh * 0.04; y += 2)
    for (let x = cx - fw * 0.3; x <= cx + fw * 0.3; x += 2) {
      if (isHair(x, y)) hairPx++;
      else if (isSkin(x, y)) skinPx++;
    }
  const scalpCoverage = hairPx / Math.max(1, hairPx + skinPx);

  // Fringe over the forehead.
  let fr = 0,
    frN = 0;
  for (let y = topY; y < topY + fh * 0.16; y += 2)
    for (let x = cx - fw * 0.25; x <= cx + fw * 0.25; x += 3) {
      frN++;
      if (isHair(x, y)) fr++;
    }
  const fringe = fr / Math.max(1, frN);

  // Lowest hair beside the face (front + side views): long hair falls past the jaw.
  let sideBottom = 0;
  for (const s of [front, ...sides]) {
    const g = s.frame;
    const gfh = ly(g, 152) - ly(g, 10);
    const minX = Math.min(...[234, 454].map((i) => lx(g, i)));
    const maxX = Math.max(...[234, 454].map((i) => lx(g, i)));
    for (let y = ly(g, 10); y < Math.min(g.height, ly(g, 152) + gfh * 0.6); y += 3) {
      let hits = 0;
      for (let x = minX - gfh * 0.25; x < maxX + gfh * 0.25; x += 3) {
        if (x > minX && x < maxX) continue;
        const xi = Math.round(x),
          yi = Math.round(y);
        if (xi >= 0 && xi < g.width && s.categories[yi * g.width + xi] === SEG_CLASSES.hair) hits++;
      }
      if (hits > 3) sideBottom = Math.max(sideBottom, (y - ly(g, 10)) / gfh);
    }
  }

  // Hair colour: robust Lab statistics over hair pixels above the face.
  const Ls: number[] = [],
    as: number[] = [],
    bs: number[] = [];
  for (let y = Math.max(0, hairTop); y < topY; y += 2)
    for (let x = cx - fw * 0.4; x <= cx + fw * 0.4; x += 2) {
      if (!isHair(x, y)) continue;
      const i = (Math.round(y) * W + Math.round(x)) * 4;
      const lab = rgbToLab(front.pixels[i], front.pixels[i + 1], front.pixels[i + 2]);
      Ls.push(lab[0]);
      as.push(lab[1]);
      bs.push(lab[2]);
    }
  const color = Ls.length > 50 ? labToHex(percentile(Ls, 0.6), percentile(as, 0.5), percentile(bs, 0.5)) : "#2a211b";

  const cut = measureCut(front);

  // Map measurements to the closest preset.
  let base: NaturalHair["base"] = "textured_crop";
  let lengthClass: HairBeardEstimate["lengthClass"] = "short";
  let lengthScale = 1;
  if (scalpCoverage < 0.25) {
    base = "buzz_cut";
    lengthClass = "bald";
    lengthScale = 0.35;
  } else if (sideBottom > 1.05) {
    base = "long";
    lengthClass = "long";
    lengthScale = Math.min(1.6, Math.max(0.6, (sideBottom - 0.6) / 0.7));
  } else if (sideBottom > 0.7 && fringe > 0.25) {
    base = "curtains";
    lengthClass = "medium";
  } else if (hairHeight < 0.06) {
    base = "buzz_cut";
    lengthClass = "buzz";
    lengthScale = Math.max(0.5, hairHeight / 0.04);
  } else if (fringe > 0.35) {
    base = hairHeight > 0.16 ? "curtains" : "french_crop";
  } else if (hairHeight > 0.2) {
    // Tall hair on top reads as a longer textured cut; a quiff's lifted
    // front wall looks styled, not like the person's own hair.
    base = "textured_crop";
    lengthClass = "medium";
    lengthScale = Math.min(1.45, Math.max(1, hairHeight / 0.15));
  } else {
    lengthScale = Math.min(1.4, Math.max(0.7, hairHeight / 0.12));
  }
  const natural: NaturalHair = {
    base,
    lengthScale,
    // Real hair rarely stands more than a couple of centimetres off the scalp.
    volume: Math.min(0.5, Math.max(0.12, 0.1 + hairHeight * 1.4)),
    curl: 0.15,
    color,
    // A bald scalp gets no hair at all (a 0.1 floor used to sprinkle stubble over it).
    density: scalpCoverage < 0.08 ? 0 : Math.min(1, Math.max(0.1, scalpCoverage * 1.1)),
  };
  // Medium hair (a fringe, covered temples): describe the actual cut instead
  // of snapping to the nearest preset, whose faded sides would bare the
  // temples and the skin behind the ears.
  const sideCut = {
    sideLength: 0.012 + 0.02 * cut.temple + 0.025 * cut.ears,
    backLength: 0.03 + 0.02 * Math.max(cut.temple, cut.ears),
    napeLength: 0.012 + 0.012 * Math.max(cut.temple, cut.ears),
    fade: Math.max(0, Math.min(0.6, 0.7 - 1.4 * cut.temple - cut.ears)),
  };
  if (scalpCoverage >= 0.25 && base !== "long" && cut.fringe > 0.3) {
    // A fringe no preset has: hair falling forward to the brows.
    const tall = Math.min(1, hairHeight / 0.25);
    natural.base = "french_crop";
    natural.lengthScale = 1;
    natural.shape = {
      ...sideCut,
      topLength: 0.045 + 0.018 * tall + 0.005 * cut.fringe,
      frontLength: 0.045 + 0.03 * cut.fringe,
      flow: "forward",
      gravity: 0.25 + 0.2 * cut.fringe,
      messiness: 0.35 + 0.2 * tall,
      lift: 0.3,
      volume: Math.min(0.45, Math.max(0.28, 0.1 + hairHeight * 1.2)),
    };
    lengthClass = "medium";
  } else if (scalpCoverage >= 0.25 && base !== "long" && base !== "buzz_cut") {
    const preset = HAIRSTYLE_PRESETS[base];
    const shape: NonNullable<NaturalHair["shape"]> = {};
    if (Math.max(cut.temple, cut.ears) > 0.3) {
      // The preset's style on top, but the sides as they really are (no fade when the temples are covered).
      // (shape lengths are scaled by lengthScale later, like the preset's: sides and nape by its root)
      const r = Math.sqrt(lengthScale);
      Object.assign(shape, {
        sideLength: Math.max(preset.sideLength, sideCut.sideLength / r),
        backLength: Math.max(preset.backLength, sideCut.backLength / lengthScale),
        napeLength: Math.max(preset.napeLength, sideCut.napeLength / r),
        fade: Math.min(preset.fade, sideCut.fade),
      });
    }
    if (cut.fringe < 0.12 && preset.flow === "forward" && preset.topLength * lengthScale > 0.03) {
      // A clear forehead: the hair is worn up and back, it must not fall over it.
      Object.assign(shape, { flow: "back", frontLift: 0.35, lift: 0.4 });
    }
    if (Object.keys(shape).length) natural.shape = shape;
  }
  if (process.env.NODE_ENV !== "production") console.info("[likeness] hair", { hairHeight, scalpCoverage, fringe, sideBottom, cut, natural });

  // Facial hair: hair-class share and darkening of the lower face.
  const lips = LIPS_OUTER.map((i) => [lx(f, i), ly(f, i)] as [number, number]);
  const oval = FACE_OVAL.map((i) => [lx(f, i), ly(f, i)] as [number, number]);
  const yNose = ly(f, 2),
    yChin = ly(f, 152);
  let beardHair = 0,
    beardN = 0,
    centreHair = 0,
    centreN = 0,
    lowLum = 0,
    lowN = 0;
  // (the chin may be out of frame on a tilted selfie: stay inside the image)
  for (let y = Math.max(0, yNose); y < Math.min(H - 1, yChin); y += 2)
    for (let x = Math.max(0, lx(f, 172)); x < Math.min(W - 1, lx(f, 397)); x += 2) {
      if (!inPoly(x, y, oval) || inPoly(x, y, lips)) continue;
      const i = Math.round(y) * W + Math.round(x);
      const hair = front.categories[i] === SEG_CLASSES.hair;
      beardN++;
      if (hair) beardHair++;
      if (Math.abs(x - cx) < fw * 0.14) {
        centreN++;
        if (hair) centreHair++;
      }
      if (!hair) {
        lowLum += 0.299 * front.pixels[i * 4] + 0.587 * front.pixels[i * 4 + 1] + 0.114 * front.pixels[i * 4 + 2];
        lowN++;
      }
    }
  const cheek = meanSkinRgb(front, [50, 280, 101, 330]);
  const cheekLum = cheek ? 0.299 * cheek[0] + 0.587 * cheek[1] + 0.114 * cheek[2] : 128;
  const darkness = lowN ? lowLum / lowN / cheekLum : 1;
  const coverage = beardHair / Math.max(1, beardN);
  const centreCov = centreHair / Math.max(1, centreN);
  let detected: BeardId = "clean";
  if (coverage > 0.45) detected = "full";
  else if (coverage > 0.2) detected = centreCov > coverage * 2 ? "goatee" : "short";
  else if (centreCov > 0.3) detected = "goatee";
  else if (darkness < 0.86) detected = "stubble";

  return {
    natural,
    lengthClass,
    beard: { detected, coverage: +coverage.toFixed(3) },
    bakedBeard: finite01(coverage * 1.6 + Math.max(0, 1 - darkness) * 2.5),
  };
}

/**
 * How the hair frames the face in the frontal photo:
 *   fringe — how much of the forehead is covered (1 = hair down to the brows),
 *   temple — hair over the temples (0 = faded or bare),
 *   ears   — hair over the tops of the ears.
 * Measured from the brows up (the tracker's top-of-face point sits on the
 * fringe itself, so it can't be the reference).
 */
export function measureCut(front: SegmentedFrame): { fringe: number; temple: number; ears: number } {
  const f = front.frame;
  const W = f.width,
    H = f.height;
  const cat = (x: number, y: number) => {
    const xi = Math.round(x),
      yi = Math.round(y);
    return xi < 0 || yi < 0 || xi >= W || yi >= H ? -1 : front.categories[yi * W + xi];
  };
  const isHair = (x: number, y: number) => cat(x, y) === SEG_CLASSES.hair;
  const browY = [105, 334, 66, 296].reduce((a, i) => a + ly(f, i), 0) / 4;
  const eyeY = (ly(f, 159) + ly(f, 386)) / 2;
  const B = Math.max(1, ly(f, 152) - browY);
  const cx = lx(f, 9);
  const fw = Math.max(1, lx(f, 454) - lx(f, 234));

  // Visible forehead per column above the brows; a fringe shortens it.
  const heights: number[] = [];
  for (let x = cx - fw * 0.28; x <= cx + fw * 0.28; x += Math.max(1, fw / 120)) {
    let h = B * 0.8;
    for (let y = browY - B * 0.04; y > browY - B * 0.8; y -= Math.max(1, B / 250)) {
      if (isHair(x, y) && isHair(x, y - 2)) {
        h = browY - y;
        break;
      }
    }
    heights.push(h / B);
  }
  // A fringe has gaps between locks: judge by the better-covered columns.
  const forehead = heights.length ? percentile(heights, 0.35) : 0.5;
  const fringe = Math.max(0, Math.min(1, (0.36 - forehead) / 0.24));

  // Share of hair (vs skin) in a box; background and clothes don't count.
  const share = (x0: number, x1: number, y0: number, y1: number) => {
    let hair = 0,
      n = 0;
    const step = Math.max(1, fw / 100);
    for (let y = Math.min(y0, y1); y < Math.max(y0, y1); y += step)
      for (let x = Math.min(x0, x1); x < Math.max(x0, x1); x += step) {
        const c = cat(x, y);
        if (c === SEG_CLASSES.hair) hair++;
        if (c === SEG_CLASSES.hair || c === SEG_CLASSES.faceSkin || c === SEG_CLASSES.bodySkin) n++;
      }
    return n > 20 ? hair / n : 0;
  };
  const temple =
    (share(lx(f, 33), lx(f, 234) - fw * 0.06, browY - B * 0.28, eyeY) +
      share(lx(f, 263), lx(f, 454) + fw * 0.06, browY - B * 0.28, eyeY)) /
    2;
  const ears =
    (share(lx(f, 234) + fw * 0.02, lx(f, 234) - fw * 0.16, eyeY, eyeY + B * 0.3) +
      share(lx(f, 454) - fw * 0.02, lx(f, 454) + fw * 0.16, eyeY, eyeY + B * 0.3)) /
    2;
  return { fringe, temple, ears };
}

const finite01 = (v: number) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

function percentile(v: number[], p: number) {
  const s = [...v].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(p * s.length))];
}

function labToHex(L: number, a: number, b: number) {
  const fy = (L + 16) / 116,
    fx = fy + a / 500,
    fz = fy - b / 200;
  const inv = (t: number) => (t ** 3 > 216 / 24389 ? t ** 3 : (116 * t - 16) / (24389 / 27));
  const X = inv(fx) * 0.95047,
    Y = inv(fy),
    Z = inv(fz) * 1.08883;
  const r = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  const g = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  const bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;
  const enc = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(Math.max(0, c), 1 / 2.4) - 0.055);
  return rgbToHex(enc(r), enc(g), enc(bl));
}

/**
 * Iris colour from the front photo: pixels in the iris ring (outside the pupil,
 * without catchlights or the lid shadow), median in each channel. Returns
 * undefined when the eyes are closed or too small to read.
 */
export function sampleIrisColor(frame: { image: HTMLCanvasElement; width: number; height: number; landmarks: Float32Array }): string | undefined {
  const L = frame.landmarks;
  const ctx = frame.image.getContext("2d", { willReadFrequently: true });
  if (!ctx || L.length < 478 * 3) return undefined;
  const px = (i: number) => [L[i * 3] * frame.width, L[i * 3 + 1] * frame.height];
  const rs: number[] = [],
    gs: number[] = [],
    bs: number[] = [];
  for (const [c, ring] of [
    [468, [469, 470, 471, 472]],
    [473, [474, 475, 476, 477]],
  ] as const) {
    const [cx, cy] = px(c);
    const r = ring.reduce((s, i) => s + Math.hypot(px(i)[0] - cx, px(i)[1] - cy), 0) / ring.length;
    if (r < 3) continue;
    const x0 = Math.max(0, Math.floor(cx - r)),
      y0 = Math.max(0, Math.floor(cy - r));
    const w = Math.min(frame.width - x0, Math.ceil(2 * r)),
      h = Math.min(frame.height - y0, Math.ceil(2 * r));
    if (w <= 0 || h <= 0) continue;
    const d = ctx.getImageData(x0, y0, w, h).data;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const dd = Math.hypot(x0 + x - cx, y0 + y - cy) / r;
        if (dd < 0.4 || dd > 0.85 || y0 + y < cy - r * 0.45) continue; // pupil, limbus, upper-lid shadow
        const o = (y * w + x) * 4;
        const lum = 0.299 * d[o] + 0.587 * d[o + 1] + 0.114 * d[o + 2];
        if (lum > 200 || lum < 12) continue; // catchlights, lashes
        rs.push(d[o]);
        gs.push(d[o + 1]);
        bs.push(d[o + 2]);
      }
  }
  if (rs.length < 20) return undefined;
  const med = (a: number[]) => a.sort((p, q) => p - q)[a.length >> 1];
  return `#${[med(rs), med(gs), med(bs)].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;
}
