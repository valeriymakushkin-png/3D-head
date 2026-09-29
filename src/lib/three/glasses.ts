import {
  CatmullRomCurve3,
  Color,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Path,
  Shape,
  ShapeGeometry,
  SphereGeometry,
  CylinderGeometry,
  TubeGeometry,
  Vector3,
  type Material,
} from "three";
import type { GlassesId } from "@/lib/avatar/look";
import { type HeadRig, LM, lmk, mid } from "@/lib/head/rig";

/**
 * Procedural eyewear fitted to the head rig: lenses centred on the eyes at a
 * 12 mm vertex distance, 8° pantoscopic tilt, 5° face-form wrap, frame width
 * matched to the temples, arms routed back over the ears.
 */

type Outline = Array<[number, number]>;

interface FrameSpec {
  kind: "metal" | "acetate";
  lensW: number;
  lensH: number;
  outline: (w: number, h: number) => Outline;
  rim: number; // tube radius (metal) or rim width (acetate)
  depth: number; // acetate thickness
  frame: () => Material;
  accent?: () => Material;
  defaultTint: number;
  tintColor: string;
  doubleBridge?: boolean;
  nosePads?: boolean;
  yOffset: number;
}

const N = 72;

function superellipse(w: number, h: number, n: number, topScale = 1, bottomScale = 1): Outline {
  const a = w / 2,
    b = h / 2;
  const out: Outline = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t),
      s = Math.sin(t);
    const x = a * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
    const y = b * Math.sign(s) * Math.pow(Math.abs(s), 2 / n) * (s >= 0 ? topScale : bottomScale);
    out.push([x, y]);
  }
  return out;
}

/** Teardrop aviator; +x is the temple side, −x the nasal side. */
function aviator(w: number, h: number): Outline {
  const a = w / 2,
    b = h / 2;
  const out: Outline = [];
  for (let i = 0; i < N; i++) {
    const t = (i / N) * Math.PI * 2;
    const c = Math.cos(t),
      s = Math.sin(t);
    if (s >= 0) {
      out.push([a * Math.sign(c) * Math.pow(Math.abs(c), 0.55), b * 0.78 * Math.pow(s, 0.55)]);
    } else {
      const as = Math.abs(s);
      out.push([a * c * (1 - 0.16 * as) - a * 0.14 * as, -b * 1.18 * Math.pow(as, 0.85)]);
    }
  }
  return out;
}

const gold = () => new MeshStandardMaterial({ color: new Color("#d6b273"), metalness: 1, roughness: 0.2 });
const antiqueGold = () => new MeshStandardMaterial({ color: new Color("#b99461"), metalness: 1, roughness: 0.28 });
const titanium = () => new MeshStandardMaterial({ color: new Color("#c7cad0"), metalness: 1, roughness: 0.3 });
const glossAcetate = () =>
  new MeshPhysicalMaterial({ color: new Color("#0b0b0c"), roughness: 0.25, clearcoat: 1, clearcoatRoughness: 0.06 });
const matteAcetate = () => new MeshPhysicalMaterial({ color: new Color("#141416"), roughness: 0.55, clearcoat: 0.3 });

export const FRAME_SPECS: Record<Exclude<GlassesId, "none">, FrameSpec> = {
  aviator: {
    kind: "metal",
    lensW: 0.058,
    lensH: 0.05,
    outline: aviator,
    rim: 0.0009,
    depth: 0,
    frame: gold,
    defaultTint: 0.82,
    tintColor: "#1f2a24",
    doubleBridge: true,
    nosePads: true,
    yOffset: -0.004,
  },
  round: {
    kind: "metal",
    lensW: 0.045,
    lensH: 0.045,
    outline: (w, h) => superellipse(w, h, 2),
    rim: 0.00085,
    depth: 0,
    frame: antiqueGold,
    defaultTint: 0,
    tintColor: "#2a2420",
    nosePads: true,
    yOffset: 0,
  },
  rectangle: {
    kind: "acetate",
    lensW: 0.054,
    lensH: 0.036,
    outline: (w, h) => superellipse(w, h, 5),
    rim: 0.0042,
    depth: 0.004,
    frame: matteAcetate,
    defaultTint: 0,
    tintColor: "#222222",
    yOffset: 0.001,
  },
  luxury: {
    kind: "acetate",
    lensW: 0.056,
    lensH: 0.044,
    outline: (w, h) => superellipse(w, h, 3.6, 1.04, 0.94),
    rim: 0.0058,
    depth: 0.0055,
    frame: glossAcetate,
    accent: gold,
    defaultTint: 0.78,
    tintColor: "#1a1512",
    yOffset: 0,
  },
  minimal: {
    kind: "metal",
    lensW: 0.05,
    lensH: 0.035,
    outline: (w, h) => superellipse(w, h, 3),
    rim: 0.0006,
    depth: 0,
    frame: titanium,
    defaultTint: 0,
    tintColor: "#222222",
    nosePads: true,
    yOffset: 0.001,
  },
};

export function lensMaterial(tint: number, tintColor: string) {
  const c = new Color("#ffffff").lerp(new Color(tintColor), Math.min(1, tint * 1.2));
  return new MeshPhysicalMaterial({
    color: c,
    transparent: true,
    opacity: 0.07 + tint * 0.83,
    roughness: 0.02,
    metalness: 0,
    specularIntensity: 1,
    envMapIntensity: 2.2,
    depthWrite: false,
  });
}

export function buildGlasses(style: Exclude<GlassesId, "none">, rig: HeadRig, tintOverride: number | null): Group {
  const spec = FRAME_SPECS[style];
  const group = new Group();
  group.name = `glasses-${style}`;

  const eyeR = mid(lmk(rig, LM.eyeROuter), lmk(rig, LM.eyeRInner));
  const eyeL = mid(lmk(rig, LM.eyeLOuter), lmk(rig, LM.eyeLInner));
  const sellion = lmk(rig, LM.sellion);
  const templeW = Math.abs(lmk(rig, LM.templeL)[0] - lmk(rig, LM.templeR)[0]);
  const pd = Math.abs(eyeL[0] - eyeR[0]);
  const bridgeW = Math.max(0.014, pd - spec.lensW);
  // Scale the lens so the frame spans the temples.
  const targetW = templeW * 0.96;
  const widthNow = 2 * spec.lensW + bridgeW + 2 * spec.rim;
  const k = Math.min(1.06, Math.max(0.9, targetW / widthNow));
  const lensW = spec.lensW * k;
  const lensH = spec.lensH * k;
  const eyeY = (eyeL[1] + eyeR[1]) / 2 + spec.yOffset;
  const lensZ = Math.max(eyeL[2], eyeR[2]) + 0.012;
  const lensCx = (pd / 2) * (0.5 + 0.5 * ((bridgeW + lensW) / pd));

  const frameMat = spec.frame();
  const accentMat = spec.accent?.() ?? frameMat;
  const tint = tintOverride ?? spec.defaultTint;
  const lensMat = lensMaterial(tint, spec.tintColor);

  const tilt = (-8 * Math.PI) / 180;
  const wrap = (5 * Math.PI) / 180;
  const outline = spec.outline(lensW, lensH);
  // Lens base curve (sag = k·r²); acetate fronts are flat so their lenses are too.
  const sag = spec.kind === "metal" ? 3.6 : 1.2;
  const hinge: Record<number, Vector3> = {};
  const innerTop: Record<number, Vector3> = {};
  const innerBottom: Record<number, Vector3> = {};

  for (const side of [1, -1] as const) {
    const lens = new Group();
    lens.position.set(side * lensCx, eyeY, lensZ);
    lens.rotation.set(tilt, side * wrap, 0, "YXZ");
    group.add(lens);

    // outline mirrored so +x is always the temple side
    const pts = outline.map(([x, y]) => new Vector3(side * x, y, -sag * (x * x + y * y)));
    if (spec.kind === "metal") {
      const curve = new CatmullRomCurve3(pts, true, "centripetal");
      lens.add(new Mesh(new TubeGeometry(curve, 160, spec.rim, 8, true), frameMat));
    } else {
      const outer = offsetOutline(outline, spec.rim);
      const shapePts = outer.map(([x, y]) => [side * x, y] as [number, number]);
      const s2 = new Shape();
      s2.moveTo(shapePts[0][0], shapePts[0][1]);
      for (const [x, y] of shapePts.slice(1)) s2.lineTo(x, y);
      const hole = new Path();
      const inner = outline.map(([x, y]) => [side * x, y] as [number, number]);
      hole.moveTo(inner[0][0], inner[0][1]);
      for (const [x, y] of inner.slice(1)) hole.lineTo(x, y);
      s2.holes.push(hole);
      const geo = new ExtrudeGeometry(s2, {
        depth: spec.depth,
        bevelEnabled: true,
        bevelThickness: 0.0008,
        bevelSize: 0.0006,
        bevelSegments: 3,
        curveSegments: 4,
      });
      geo.translate(0, 0, -spec.depth / 2);
      lens.add(new Mesh(geo, frameMat));
    }
    // lens
    const ls = new Shape();
    ls.moveTo(side * outline[0][0], outline[0][1]);
    for (const [x, y] of outline.slice(1)) ls.lineTo(side * x, y);
    const lg = new ShapeGeometry(ls, 12);
    const pos = lg.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i),
        y = pos.getY(i);
      pos.setZ(i, -sag * (x * x + y * y));
    }
    lg.computeVertexNormals();
    const lensMesh = new Mesh(lg, lensMat);
    lensMesh.renderOrder = 2;
    lens.add(lensMesh);

    lens.updateMatrixWorld(true);
    const maxX = Math.max(...outline.map(([x]) => x));
    const topY = Math.max(...outline.map(([, y]) => y));
    const minX = Math.min(...outline.map(([x]) => x));
    const rimOut = spec.rim;
    hinge[side] = new Vector3(side * (maxX + rimOut * 0.6), topY * 0.55, -spec.depth * 0.5).applyMatrix4(lens.matrixWorld);
    innerTop[side] = new Vector3(side * (minX - rimOut * 0.3), topY * 0.45, 0).applyMatrix4(lens.matrixWorld);
    innerBottom[side] = new Vector3(side * (minX * 0.7), -lensH * 0.28, -0.004).applyMatrix4(lens.matrixWorld);
  }

  // Bridge
  const bridgeTopY = Math.max(innerTop[1].y, sellion[1] + 0.002);
  const bridgeCurve = new CatmullRomCurve3([
    innerTop[-1],
    new Vector3(0, bridgeTopY + (spec.kind === "metal" ? 0.003 : 0.001), lensZ + 0.002),
    innerTop[1],
  ]);
  const bridgeR = spec.kind === "metal" ? spec.rim * 1.15 : spec.depth * 0.42;
  group.add(new Mesh(new TubeGeometry(bridgeCurve, 32, bridgeR, 8, false), frameMat));
  if (spec.doubleBridge) {
    const topL = hinge[1].clone().setX(lensCx * 0.62).setY(eyeY + lensH * 0.36);
    const topR = topL.clone().setX(-lensCx * 0.62);
    const brow = new CatmullRomCurve3([topR, new Vector3(0, eyeY + lensH * 0.36, lensZ + 0.003), topL]);
    group.add(new Mesh(new TubeGeometry(brow, 32, spec.rim * 1.1, 8, false), frameMat));
  }
  if (spec.nosePads) {
    for (const side of [1, -1]) {
      const pad = new Mesh(new SphereGeometry(0.0026, 16, 12), lensMat);
      pad.scale.set(0.55, 1.2, 0.4);
      const nose = new Vector3(side * 0.0075, innerBottom[side].y + 0.004, sellion[2] - 0.006);
      pad.position.copy(nose);
      group.add(pad);
      const arm = new CatmullRomCurve3([innerBottom[side].clone().setY(innerBottom[side].y + 0.008), nose]);
      group.add(new Mesh(new TubeGeometry(arm, 8, 0.0004, 6, false), frameMat));
    }
  }

  // Temples (arms) back over the ears.
  const earX = Math.max(rig.radii[0] + 0.005, Math.abs(lmk(rig, LM.cheekR)[0]) + 0.007);
  const earZ = Math.min(lmk(rig, LM.cheekR)[2], lmk(rig, LM.cheekL)[2]) - 0.05;
  const armR = spec.kind === "metal" ? spec.rim * 1.1 : spec.depth * 0.36;
  for (const side of [1, -1]) {
    const h = hinge[side];
    const curve = new CatmullRomCurve3([
      h,
      new Vector3(side * (earX + 0.002), h.y + 0.001, h.z - 0.03),
      new Vector3(side * earX, eyeY + 0.004, earZ + 0.006),
      new Vector3(side * (earX - 0.003), eyeY - 0.02, earZ - 0.024),
    ]);
    const arm = new Mesh(new TubeGeometry(curve, 48, armR, 8, false), frameMat);
    if (spec.kind === "acetate") arm.scale.set(1, 1, 1);
    group.add(arm);
    if (spec.accent && spec.accent !== spec.frame) {
      const rivet = new Mesh(new CylinderGeometry(0.0011, 0.0011, 0.0012, 16), accentMat);
      rivet.rotation.x = Math.PI / 2;
      rivet.position.copy(h).add(new Vector3(-side * 0.002, 0, spec.depth * 0.5 + 0.0003));
      group.add(rivet);
      const hingeBar = new Mesh(new CylinderGeometry(0.0009, 0.0009, 0.009, 12), accentMat);
      hingeBar.rotation.z = Math.PI / 2;
      hingeBar.position.copy(h).add(new Vector3(side * 0.001, 0, -0.006));
      group.add(hingeBar);
    }
  }
  group.traverse((o) => {
    if ((o as Mesh).isMesh) o.castShadow = true;
  });
  return group;
}

/** Outward offset of a closed outline along its 2D normals. */
function offsetOutline(o: Outline, d: number): Outline {
  const n = o.length;
  // orientation sign so normals point outward
  let area = 0;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = o[i];
    const [x2, y2] = o[(i + 1) % n];
    area += x1 * y2 - x2 * y1;
  }
  const sgn = area > 0 ? 1 : -1;
  return o.map((p, i) => {
    const a = o[(i - 1 + n) % n];
    const b = o[(i + 1) % n];
    const tx = b[0] - a[0],
      ty = b[1] - a[1];
    const l = Math.hypot(tx, ty) || 1;
    return [p[0] + (sgn * ty * d) / l, p[1] - (sgn * tx * d) / l];
  });
}

export function disposeGroup(g: Group) {
  g.traverse((o) => {
    const m = o as Mesh;
    if (m.isMesh) {
      m.geometry.dispose();
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach((mt) => mt.dispose());
    }
  });
}
