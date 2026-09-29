"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { PerspectiveCamera, type Object3D } from "three";
import { CAMERA_TARGET, PREVIEW_VIEWS, previewTargets } from "@/lib/engine/previews";
import { useSceneVersion } from "@/lib/engine/sceneBus";
import { ThumbnailFactory, useThumbs } from "@/lib/engine/thumbnails";
import type { HeadAsset } from "@/lib/head/asset";
import { useStudio } from "@/store/studio";

const PREVIEW_W = 168;
const PREVIEW_H = 208;
const THUMB_W = 176;
const THUMB_H = 220;

/**
 * Owns rendering for the studio canvas (useFrame priority 1). Per frame:
 *   1. at most one carousel thumbnail (off-screen scene, same GL context),
 *   2. the four live previews — only when the avatar actually changed,
 *   3. the main view, or the before/after split when comparing.
 * Sub-renders go to a scissored corner of the default framebuffer and are
 * copied out with drawImage, so they get the same tone mapping and colour
 * management as the main view.
 */
export function RenderPipeline({ asset }: { asset: HeadAsset }) {
  const { gl, scene } = useThree();
  const version = useSceneVersion((s) => s.version);
  const lastPreview = useRef({ version: -1, at: 0 });
  const factory = useMemo(() => new ThumbnailFactory(asset), [asset]);
  const staged = useRef<{ key: string } | null>(null);
  const busy = useRef(false);
  const previewCams = useMemo(
    () =>
      PREVIEW_VIEWS.map((v) => {
        const c = new PerspectiveCamera(22, PREVIEW_W / PREVIEW_H, 0.02, 10);
        c.position.set(Math.sin(v.azimuth) * 0.95, 0.0, Math.cos(v.azimuth) * 0.95);
        c.lookAt(...CAMERA_TARGET);
        return { id: v.id, cam: c };
      }),
    [],
  );
  const scratch = useMemo(() => (typeof document === "undefined" ? null : document.createElement("canvas")), []);

  useEffect(() => () => factory.dispose(), [factory]);

  // Pull the next thumbnail job and stage it asynchronously.
  useFrame(() => {
    if (busy.current || staged.current) return;
    const job = useThumbs.getState().take();
    if (!job) return;
    busy.current = true;
    factory
      .stage(job.look)
      .then((ok) => {
        if (ok) staged.current = { key: job.key };
      })
      .catch((e) => console.warn("[thumb]", e))
      .finally(() => (busy.current = false));
  });

  useFrame((state) => {
    const { camera, size } = state;
    const dpr = gl.getPixelRatio();
    const bufH = size.height * dpr;
    gl.autoClear = true;

    const subRender = (sc: Object3D, cam: PerspectiveCamera, w: number, h: number, out: HTMLCanvasElement | null) => {
      if (!out || w > size.width || h > size.height) return;
      gl.setScissorTest(true);
      gl.setViewport(0, 0, w, h);
      gl.setScissor(0, 0, w, h);
      gl.render(sc, cam);
      const ctx = out.getContext("2d");
      if (ctx) {
        if (out.width !== w * dpr) {
          out.width = w * dpr;
          out.height = h * dpr;
        }
        ctx.clearRect(0, 0, out.width, out.height);
        ctx.drawImage(gl.domElement, 0, bufH - h * dpr, w * dpr, h * dpr, 0, 0, out.width, out.height);
      }
    };

    // 1) thumbnail
    if (staged.current && scratch) {
      const key = staged.current.key;
      staged.current = null;
      factory.scene.environment = scene.environment;
      factory.setPixelSize(THUMB_H * dpr);
      subRender(factory.scene, factory.camera, THUMB_W, THUMB_H, scratch);
      useThumbs.getState().done(key, scratch.toDataURL("image/webp", 0.86));
    }

    // 2) previews (debounced: wait for the scene to settle)
    const lp = lastPreview.current;
    const now = performance.now();
    if (lp.version !== version && now - lp.at > 140) {
      lp.version = version;
      lp.at = now;
      const before = scene.getObjectByName("avatar-before");
      if (before) before.visible = false;
      for (const { id, cam } of previewCams) subRender(scene, cam, PREVIEW_W, PREVIEW_H, previewTargets.get(id) ?? null);
    }

    // 3) main view
    gl.setScissorTest(false);
    gl.setViewport(0, 0, size.width, size.height);
    const compare = useStudio.getState().compare;
    const before = scene.getObjectByName("avatar-before");
    const after = scene.getObjectByName("avatar-after") ?? scene.getObjectByName("avatar-main");
    if (compare && before && after) {
      const splitX = Math.round(size.width * compare.split);
      gl.autoClear = false;
      gl.clear();
      gl.setScissorTest(true);
      before.visible = true;
      after.visible = false;
      gl.setScissor(0, 0, splitX, size.height);
      gl.render(scene, camera);
      before.visible = false;
      after.visible = true;
      gl.setScissor(splitX, 0, size.width - splitX, size.height);
      gl.render(scene, camera);
      gl.setScissorTest(false);
      gl.autoClear = true;
    } else {
      if (before) before.visible = false;
      gl.render(scene, camera);
    }
  }, 1);

  return null;
}
