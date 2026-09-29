"use client";

import {
  AmbientLight,
  Box3,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
  type BufferGeometry,
  type Texture,
} from "three";
import { getFaceLandmarker } from "@/lib/recon/mediapipe";

/**
 * Auto-rigging: finds the 478 MediaPipe landmarks on an arbitrary textured
 * head mesh by rendering it frontally, running the face landmarker on the
 * render and ray-casting every landmark back onto the surface. This is how
 * any template (or artist-made head) gets a rig without manual work.
 *
 * Returns landmarks in the mesh's own coordinate space.
 */
export async function autoRigMesh(geometry: BufferGeometry, map: Texture, size = 1024): Promise<Float32Array> {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  renderer.outputColorSpace = SRGBColorSpace;
  const scene = new Scene();
  map.colorSpace = SRGBColorSpace;
  const mesh = new Mesh(geometry, new MeshStandardMaterial({ map, roughness: 0.8 }));
  scene.add(mesh);
  scene.add(new AmbientLight(0xffffff, 1.4));
  const key = new DirectionalLight(0xffffff, 1.6);
  key.position.set(0, 0.3, 1);
  scene.add(key);

  const box = new Box3().setFromBufferAttribute(geometry.getAttribute("position") as never);
  const bsize = box.getSize(new Vector3());
  const camera = new PerspectiveCamera(22, 1, 0.01, 1000);
  const detector = await getFaceLandmarker("IMAGE");

  const frame = (center: Vector3, height: number) => {
    const dist = height / 2 / Math.tan((camera.fov * Math.PI) / 360);
    camera.position.set(center.x, center.y, box.max.z + dist);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    renderer.render(scene, camera);
    return detector.detect(renderer.domElement);
  };

  // Pass 1: whole bust. Pass 2: zoom on the detected face for precision.
  let res = frame(box.getCenter(new Vector3()), Math.max(bsize.x, bsize.y) * 1.05);
  if (!res.faceLandmarks.length) throw new Error("Auto-rig: no face found in template render");
  let lms = res.faceLandmarks[0];
  const xs = lms.map((l) => l.x),
    ys = lms.map((l) => l.y);
  const cxn = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cyn = (Math.min(...ys) + Math.max(...ys)) / 2;
  const hn = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  const ray = new Raycaster();
  const focus = hitAt(ray, camera, mesh, cxn, cyn) ?? box.getCenter(new Vector3());
  const viewH = Math.max(bsize.x, bsize.y) * 1.05;
  res = frame(new Vector3(focus.x, focus.y, box.getCenter(new Vector3()).z), viewH * hn * 1.6);
  if (!res.faceLandmarks.length) throw new Error("Auto-rig: face lost on zoomed render");
  lms = res.faceLandmarks[0];

  const out = new Float32Array(lms.length * 3);
  const hitDist = new Float32Array(lms.length).fill(NaN);
  const origin = camera.position.clone();
  lms.forEach((l, i) => {
    const h = hitAt(ray, camera, mesh, l.x, l.y);
    if (h) {
      out.set([h.x, h.y, h.z], i * 3);
      hitDist[i] = h.distanceTo(origin);
    }
  });
  // Landmarks that missed the surface (silhouette): borrow depth from the
  // nearest landmark in image space that did hit.
  lms.forEach((l, i) => {
    if (!Number.isNaN(hitDist[i])) return;
    let best = -1,
      bestD = Infinity;
    lms.forEach((o, j) => {
      if (Number.isNaN(hitDist[j])) return;
      const d = (o.x - l.x) ** 2 + (o.y - l.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = j;
      }
    });
    ray.setFromCamera(new Vector2(l.x * 2 - 1, -(l.y * 2 - 1)), camera);
    const p = ray.ray.at(hitDist[best], new Vector3());
    out.set([p.x, p.y, p.z], i * 3);
  });
  renderer.dispose();
  renderer.forceContextLoss();
  return out;
}

function hitAt(ray: Raycaster, camera: PerspectiveCamera, mesh: Mesh, x: number, y: number): Vector3 | null {
  ray.setFromCamera(new Vector2(x * 2 - 1, -(y * 2 - 1)), camera);
  const hits = ray.intersectObject(mesh, false);
  return hits.length ? hits[0].point.clone() : null;
}
