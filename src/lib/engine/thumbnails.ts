"use client";

import {
  type BufferAttribute,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  PerspectiveCamera,
  Scene,
  type ShaderMaterial,
} from "three";
import { create } from "zustand";
import type { Look } from "@/lib/avatar/look";
import { avatarEngine } from "@/lib/engine/client";
import { THUMBNAIL_QUALITY } from "@/lib/engine/protocol";
import { resolveBeardParams, resolveHairColor, resolveHairParams } from "@/lib/hair/params";
import type { HeadAsset } from "@/lib/head/asset";
import { buildAccessories } from "@/lib/three/accessories";
import { buildGlasses, disposeGroup } from "@/lib/three/glasses";
import { createHairMaterial, setHairColor } from "@/lib/three/hairMaterial";
import { AMBIENT, STUDIO_LIGHTS } from "@/lib/three/lighting";
import { writeMasks } from "@/lib/three/masks";
import { applyEyeCut, createSkinMaterial, updateSkinUniforms, type SkinMaterial } from "@/lib/three/skinMaterial";
import { buildEyes, eyeSetup } from "@/lib/three/eyes";
import { strandGeometry } from "@/components/three/StrandMesh";
import { writeSkinShade } from "@/components/three/HeadMesh";

/** Thumbnail cache + work queue (latest category first). */
interface ThumbState {
  urls: Record<string, string>;
  queue: Array<{ key: string; look: Look }>;
  enqueue: (jobs: Array<{ key: string; look: Look }>) => void;
  done: (key: string, url: string) => void;
  take: () => { key: string; look: Look } | undefined;
}

export const useThumbs = create<ThumbState>((set, get) => ({
  urls: {},
  queue: [],
  enqueue: (jobs) => {
    const have = get().urls;
    const fresh = jobs.filter((j) => !have[j.key]);
    // new requests take priority; drop stale duplicates
    const keys = new Set(fresh.map((j) => j.key));
    set({ queue: [...fresh, ...get().queue.filter((j) => !keys.has(j.key))].slice(0, 40) });
  },
  done: (key, url) => set({ urls: { ...get().urls, [key]: url } }),
  take: () => {
    const [first, ...rest] = get().queue;
    if (first) set({ queue: rest });
    return first;
  },
}));

/**
 * Renders the user's *own* twin wearing each catalogue option, off-screen,
 * one per frame, reusing the studio's WebGL context (shared textures).
 */
export class ThumbnailFactory {
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(20, 0.8, 0.02, 10);
  private head: Mesh;
  private skin: SkinMaterial;
  private hair: Mesh;
  private beard: Mesh;
  private hairMat: ShaderMaterial;
  private beardMat: ShaderMaterial;
  private extras = new Group();
  private eyes: Group;
  private seq = 0;

  constructor(private asset: HeadAsset) {
    for (const l of STUDIO_LIGHTS) {
      const d = new DirectionalLight(new Color(l.color), l.intensity);
      d.position.set(...l.position);
      this.scene.add(d);
    }
    this.scene.add(new HemisphereLight(AMBIENT.top, AMBIENT.bottom, 0.35));
    const geo = asset.geometry.clone();
    this.skin = createSkinMaterial(asset.albedo, asset.normalMap, asset.skinColor);
    this.head = new Mesh(geo, this.skin);
    this.hairMat = createHairMaterial();
    this.beardMat = createHairMaterial();
    this.hair = new Mesh(undefined, this.hairMat);
    this.beard = new Mesh(undefined, this.beardMat);
    this.hair.frustumCulled = this.beard.frustumCulled = false;
    const eyes = eyeSetup(asset.rig, asset.analysis.eyeColor);
    applyEyeCut(this.skin, eyes);
    this.eyes = buildEyes(eyes);
    this.scene.add(this.head, this.hair, this.beard, this.extras, this.eyes);
    // three-quarter portrait, chin to crown
    this.camera.position.set(0.42, 0.05, 0.63);
    this.camera.lookAt(0, -0.005, 0);
    for (const m of [this.hairMat, this.beardMat]) m.uniforms.uCenter.value.set(...asset.rig.center);
  }

  /** Builds the scene for a look. Resolves false if superseded. */
  async stage(look: Look): Promise<boolean> {
    const my = ++this.seq;
    const a = this.asset;
    const hp = resolveHairParams(look.hair, a.natural);
    const bp = resolveBeardParams(look.beard);
    const color = resolveHairColor(look.hair, a.natural);
    const [hair, beard] = await Promise.all([
      avatarEngine.hair("thumb", a, hp, THUMBNAIL_QUALITY),
      bp ? avatarEngine.beard("thumb", a, bp, THUMBNAIL_QUALITY) : Promise.resolve(null),
    ]);
    if (my !== this.seq || !hair) return false;
    this.hair.geometry.dispose();
    this.hair.geometry = strandGeometry(hair);
    this.hairMat.uniforms.uWidth.value = hair.strandWidth * 1.4;
    this.beard.visible = !!(bp && beard);
    if (bp && beard) {
      this.beard.geometry.dispose();
      this.beard.geometry = strandGeometry(beard);
      this.beardMat.uniforms.uWidth.value = beard.strandWidth * 1.4;
    }
    setHairColor(this.hairMat, color);
    setHairColor(this.beardMat, color, 0.85);
    writeMasks(this.head.geometry.getAttribute("aMask") as BufferAttribute, this.head.geometry.getAttribute("position").array, a.rig, a.statics, hp, bp);
    writeSkinShade(this.head.geometry, hair.skinVis && hair.skinAO ? { vis: hair.skinVis, ao: hair.skinAO } : avatarEngine.baseSkin(a.id));
    updateSkinUniforms(this.skin, look, a.bakedBeard, hp, bp, color);
    this.extras.children.forEach((c) => disposeGroup(c as Group));
    this.extras.clear();
    if (look.glasses.style !== "none") this.extras.add(buildGlasses(look.glasses.style, a.rig, look.glasses.tint));
    if (look.accessories.length) this.extras.add(buildAccessories(look.accessories, a.rig));
    return true;
  }

  setPixelSize(pixelsHigh: number) {
    const px = (2 * Math.tan((this.camera.fov * Math.PI) / 360)) / pixelsHigh;
    this.hairMat.uniforms.uPixelSize.value = px;
    this.beardMat.uniforms.uPixelSize.value = px;
  }

  dispose() {
    this.seq++;
    this.head.geometry.dispose();
    this.skin.dispose();
    this.hair.geometry.dispose();
    this.beard.geometry.dispose();
    this.hairMat.dispose();
    this.beardMat.dispose();
    this.extras.children.forEach((c) => disposeGroup(c as Group));
    disposeGroup(this.eyes);
  }
}
