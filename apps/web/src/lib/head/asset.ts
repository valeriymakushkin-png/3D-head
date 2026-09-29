"use client";

import {
  BufferAttribute,
  Color,
  Matrix4,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  LinearMipmapLinearFilter,
  type BufferGeometry,
  type Mesh,
} from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { NaturalHair } from "@/lib/hair/params";
import { DEFAULT_NATURAL_HAIR } from "@/lib/hair/params";
import { type HeadRig, estimateHairline, lmk } from "@/lib/head/rig";
import { type FaceAnalysis, classifyFaceShape, skinTone } from "@/lib/style/analysis";
import { computeStaticMasks, type StaticMasks } from "@/lib/three/masks";

/** Everything the renderer needs to show one person's head. */
export interface HeadAsset {
  id: string;
  kind: "template" | "instant" | "hd";
  geometry: BufferGeometry; // head space, metres; has `aMask` (vec4)
  albedo: Texture;
  normalMap: Texture | null;
  rig: HeadRig;
  natural: NaturalHair;
  analysis: FaceAnalysis;
  statics: StaticMasks;
  /** Linear-space mean skin colour (for clean-shave / complexion). */
  skinColor: Color;
  /** 0..1 — how much facial hair is baked into the albedo. */
  bakedBeard: number;
  /** Mean captured-skin RGB (sRGB 0..255). */
  skinRgb: [number, number, number];
}

export const TEMPLATE = {
  glb: "/models/template/head.glb",
  albedo: "/models/template/albedo.jpg",
  normal: "/models/template/normal.jpg",
  rig: "/models/template/rig.json",
};

export async function loadTemplateGeometry(): Promise<BufferGeometry> {
  const gltf = await new GLTFLoader().loadAsync(TEMPLATE.glb);
  let geometry: BufferGeometry | null = null;
  gltf.scene.traverse((o) => {
    if ((o as Mesh).isMesh && !geometry) geometry = (o as Mesh).geometry.clone();
  });
  if (!geometry) throw new Error("template head has no mesh");
  return geometry;
}

export async function loadTexture(url: string, srgb: boolean, flipY: boolean): Promise<Texture> {
  const tex = await new TextureLoader().loadAsync(url);
  finishTexture(tex, srgb, flipY);
  return tex;
}

export function finishTexture(tex: Texture, srgb: boolean, flipY: boolean) {
  tex.flipY = flipY;
  if (srgb) tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 8;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
}

/** Mean texture colour around landmark UVs (cheeks & forehead). */
export function sampleSkinRgb(
  geometry: BufferGeometry,
  rig: HeadRig,
  image: CanvasImageSource & { width: number; height: number },
  flipY: boolean,
) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(image, 0, 0, 256, 256);
  const data = ctx.getImageData(0, 0, 256, 256).data;
  const pos = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  const probes = [50, 280, 101, 330, 151, 9, 117, 346].map((i) => lmk(rig, i)); // cheeks, forehead
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  for (const p of probes) {
    let best = 0,
      bestD = Infinity;
    for (let i = 0; i < pos.count; i++) {
      const d = (pos.getX(i) - p[0]) ** 2 + (pos.getY(i) - p[1]) ** 2 + (pos.getZ(i) - p[2]) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    const u = uv.getX(best),
      v = uv.getY(best);
    const x = Math.min(255, Math.max(0, Math.round(u * 255)));
    const y = Math.min(255, Math.max(0, Math.round((flipY ? 1 - v : v) * 255)));
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) {
        const xx = Math.min(255, Math.max(0, x + dx)),
          yy = Math.min(255, Math.max(0, y + dy));
        const o = (yy * 256 + xx) * 4;
        r += data[o];
        g += data[o + 1];
        b += data[o + 2];
        n++;
      }
  }
  return [r / n, g / n, b / n] as [number, number, number];
}

/** Bakes the rig transform into the geometry and adds the mask attribute. */
export function prepareHeadGeometry(geometry: BufferGeometry, rig: HeadRig, alreadyInHeadSpace: boolean) {
  if (!alreadyInHeadSpace) geometry.applyMatrix4(new Matrix4().fromArray(rig.meshToHead));
  if (!geometry.getAttribute("normal")) geometry.computeVertexNormals();
  const n = geometry.getAttribute("position").count;
  geometry.setAttribute("aMask", new BufferAttribute(new Float32Array(n * 4), 4));
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  return geometry;
}

export function buildAnalysis(rig: HeadRig, skinRgb: [number, number, number], natural: NaturalHair, beard: FaceAnalysis["beard"]): FaceAnalysis {
  const shape = classifyFaceShape(rig);
  const lengthClass: FaceAnalysis["hair"]["lengthClass"] =
    natural.density < 0.15 ? "bald" : natural.base === "buzz_cut" ? "buzz" : ["long", "curtains", "mullet"].includes(natural.base) ? (natural.base === "long" ? "long" : "medium") : "short";
  return {
    faceShape: shape.faceShape,
    faceShapeScores: shape.scores,
    metrics: shape.metrics,
    skin: skinTone(skinRgb),
    hair: { color: natural.color, lengthClass, density: natural.density, recession: 0 },
    beard,
  };
}

export async function loadTemplateHead(): Promise<HeadAsset> {
  const [geometry, albedo, normalMap, rig] = await Promise.all([
    loadTemplateGeometry(),
    // The template scan's UVs follow the classic three.js (flipY) convention.
    loadTexture(TEMPLATE.albedo, true, true),
    loadTexture(TEMPLATE.normal, false, true),
    fetch(TEMPLATE.rig).then((r) => {
      if (!r.ok) throw new Error("template rig missing — run `npm run rig:template`");
      return r.json() as Promise<HeadRig>;
    }),
  ]);
  // Hairline rules evolve with the product; the template always uses the latest.
  rig.hairline = estimateHairline(rig);
  prepareHeadGeometry(geometry, rig, false);
  const statics = computeStaticMasks(geometry.getAttribute("position").array, rig);
  const skinRgb = sampleSkinRgb(geometry, rig, albedo.image as HTMLImageElement, true);
  const natural: NaturalHair = { ...DEFAULT_NATURAL_HAIR, base: "buzz_cut", lengthScale: 0.55, color: "#3b2f27", density: 0.85 };
  const beard: FaceAnalysis["beard"] = { detected: "stubble", coverage: 0.35 };
  return {
    id: "template",
    kind: "template",
    geometry,
    albedo,
    normalMap,
    rig,
    natural,
    analysis: buildAnalysis(rig, skinRgb, natural, beard),
    statics,
    skinColor: new Color(`rgb(${skinRgb.map(Math.round).join(",")})`),
    bakedBeard: 0.35,
    skinRgb,
  };
}


/** Loads a cloud HD Twin (FLAME topology GLB produced by services/reconstruct). */
export async function loadHdHead(meta: {
  id: string;
  model_url: string;
  rig: HeadRig;
  analysis: FaceAnalysis;
  natural_hair: NaturalHair & { bakedBeard?: number; skinRgb?: [number, number, number] };
}): Promise<HeadAsset> {
  const gltf = await new GLTFLoader().loadAsync(meta.model_url);
  let mesh: Mesh | null = null;
  gltf.scene.traverse((o) => {
    if ((o as Mesh).isMesh && !mesh) mesh = o as Mesh;
  });
  if (!mesh) throw new Error("HD twin has no mesh");
  const m = mesh as Mesh;
  const geometry = m.geometry.clone();
  prepareHeadGeometry(geometry, meta.rig, true);
  const map = (m.material as { map?: Texture | null }).map;
  if (!map) throw new Error("HD twin has no texture");
  map.colorSpace = SRGBColorSpace;
  const skinRgb = meta.natural_hair.skinRgb ?? [196, 150, 128];
  const { bakedBeard = 0, skinRgb: _s, ...natural } = meta.natural_hair;
  void _s;
  return {
    id: meta.id,
    kind: "hd",
    geometry,
    albedo: map,
    normalMap: null,
    rig: meta.rig,
    natural: natural as NaturalHair,
    analysis: meta.analysis,
    statics: computeStaticMasks(geometry.getAttribute("position").array, meta.rig),
    skinColor: new Color(`rgb(${skinRgb.map(Math.round).join(",")})`),
    bakedBeard,
    skinRgb,
  };
}

/** Rebuilds a renderable head from an on-device Instant Twin record. */
export async function loadInstantHead(record: import("@/lib/recon/storage").InstantTwinRecord): Promise<HeadAsset> {
  const [geometry, normalMap, bitmap] = await Promise.all([
    loadTemplateGeometry(),
    loadTexture(TEMPLATE.normal, false, true),
    createImageBitmap(record.albedo, { imageOrientation: "none" }),
  ]);
  geometry.setAttribute("position", new BufferAttribute(record.positions.slice(), 3));
  geometry.deleteAttribute("normal");
  prepareHeadGeometry(geometry, record.rig, true);
  // Draw to a canvas: ImageBitmap uploads ignore flipY, canvases honour it.
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  bitmap.close();
  const albedo = new Texture(canvas);
  // Baked atlases are written top-down like the template, so the same flip applies.
  finishTexture(albedo, true, true);
  return {
    id: record.id,
    kind: "instant",
    geometry,
    albedo,
    normalMap,
    rig: record.rig,
    natural: record.natural,
    analysis: record.analysis,
    statics: computeStaticMasks(geometry.getAttribute("position").array, record.rig),
    skinColor: new Color(`rgb(${record.skinRgb.map(Math.round).join(",")})`),
    bakedBeard: record.bakedBeard,
    skinRgb: record.skinRgb,
  };
}
