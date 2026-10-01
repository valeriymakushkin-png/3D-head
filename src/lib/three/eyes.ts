import {
  BackSide,
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshPhysicalMaterial,
  SRGBColorSpace,
  SphereGeometry,
  Vector2,
  Vector3,
} from "three";
import { EYE_L, EYE_R, type HeadRig, lmk } from "@/lib/head/rig";

/**
 * Real eyes for twins captured with open eyes.
 *
 * The template topology has closed lids, so the photo's open eye would be
 * painted on a lid. Instead the skin shader cuts the palpebral fissure along
 * the user's own eye contour (from the photos) and a pair of eyeballs sits
 * behind it: sclera, the iris in the colour sampled from the front photo, a
 * pupil, and a glossy cornea that picks up the studio catchlights.
 */
export interface EyeSetup {
  open: boolean;
  contours: [Vector2[], Vector2[]];
  /** Fragments behind this depth are never cut (the back of the head). */
  cutZ: number;
  centres: [Vector3, Vector3];
  radius: number;
  iris: Color;
}

const RADIUS = 0.0118;

export function eyeSetup(rig: Pick<HeadRig, "landmarks">, eyeColor?: string): EyeSetup {
  // Slightly inset horizontally: the eyeball never reaches the canthi, so a
  // full-width cut would open onto the inside of the head at the corners.
  const contour = (ids: number[]) => {
    const pts = ids.map((i) => new Vector2(lmk(rig, i)[0], lmk(rig, i)[1]));
    const c = pts.reduce((a, p) => a.add(p), new Vector2()).multiplyScalar(1 / pts.length);
    return pts.map((p) => new Vector2(c.x + (p.x - c.x) * 0.9, c.y + (p.y - c.y) * 0.97));
  };
  const contours: [Vector2[], Vector2[]] = [contour(EYE_R), contour(EYE_L)];
  // Palpebral opening: upper vs lower lid at mid-eye (MediaPipe 159/145 and 386/374).
  const opening = Math.min(Math.abs(lmk(rig, 159)[1] - lmk(rig, 145)[1]), Math.abs(lmk(rig, 386)[1] - lmk(rig, 374)[1]));
  const rimZ = [...EYE_R, ...EYE_L].reduce((s, i) => s + lmk(rig, i)[2], 0) / (EYE_R.length + EYE_L.length);
  const minZ = Math.min(...[...EYE_R, ...EYE_L].map((i) => lmk(rig, i)[2]));
  const centre = (iris: number, ids: number[]) => {
    const p = lmk(rig, iris);
    // The iris landmark can sit off the contour centre on a squint; average them.
    const cx = ids.reduce((s, i) => s + lmk(rig, i)[0], 0) / ids.length;
    const cy = ids.reduce((s, i) => s + lmk(rig, i)[1], 0) / ids.length;
    // Cornea apex ~3 mm in front of the lid margins, eyeball behind it.
    return new Vector3(0.5 * (p[0] + cx), 0.5 * (p[1] + cy), rimZ + 0.003 - RADIUS);
  };
  return {
    open: !!eyeColor && opening > 0.0035,
    contours,
    cutZ: minZ - 0.006,
    centres: [centre(468, EYE_R), centre(473, EYE_L)],
    radius: RADIUS,
    iris: new Color(eyeColor ?? "#5a4230"),
  };
}

/** Equirectangular eyeball texture; the +Z pole (the cornea) is the top row. */
function eyeTexture(iris: Color): CanvasTexture {
  const W = 512,
    H = 256;
  const c = document.createElement("canvas");
  c.width = W;
  c.height = H;
  const g = c.getContext("2d")!;
  // sclera: warm white, pinker towards the back
  const sclera = g.createLinearGradient(0, 0, 0, H);
  sclera.addColorStop(0, "#dcd3c9");
  sclera.addColorStop(0.3, "#d4c7bc");
  sclera.addColorStop(0.6, "#c7a79d");
  sclera.addColorStop(1, "#9c6a64");
  g.fillStyle = sclera;
  g.fillRect(0, 0, W, H);
  // faint vessels
  g.strokeStyle = "rgba(170,70,70,0.18)";
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W;
    g.lineWidth = 0.6 + Math.random();
    g.beginPath();
    g.moveTo(x, H * (0.55 + Math.random() * 0.4));
    g.bezierCurveTo(x + 10, H * 0.45, x - 12, H * 0.35, x + (Math.random() - 0.5) * 20, H * 0.2);
    g.stroke();
  }
  // iris: polar 0..~31° of 180° → top 17 % of the texture
  const irisTop = H * 0.172;
  const pupil = H * 0.05;
  const base = iris.clone();
  const hex = (c: Color) => `#${c.getHexString()}`;
  const ig = g.createLinearGradient(0, pupil, 0, irisTop);
  ig.addColorStop(0, hex(base.clone().lerp(new Color("#c89a5a"), 0.35).multiplyScalar(0.9))); // collarette: warmer, lighter
  ig.addColorStop(0.25, hex(base.clone().multiplyScalar(1.05)));
  ig.addColorStop(0.7, hex(base));
  ig.addColorStop(0.9, hex(base.clone().multiplyScalar(0.55)));
  ig.addColorStop(1, "#15100d"); // limbal ring
  g.fillStyle = ig;
  g.fillRect(0, pupil, W, irisTop - pupil);
  // radial fibres and crypts (vertical streaks in this projection)
  for (let x = 0; x < W; x += 1.5) {
    const lightFibre = Math.random() < 0.45;
    g.fillStyle = lightFibre ? `rgba(255,245,230,${0.05 + Math.random() * 0.1})` : `rgba(0,0,0,${0.08 + Math.random() * 0.14})`;
    const y0 = pupil + Math.random() * (irisTop - pupil) * 0.3;
    g.fillRect(x, y0, 1, (irisTop - pupil) * (0.4 + Math.random() * 0.6));
  }
  // pupil with a soft edge
  const pg = g.createLinearGradient(0, 0, 0, pupil * 1.25);
  pg.addColorStop(0, "#030303");
  pg.addColorStop(0.8, "#050404");
  pg.addColorStop(1, "rgba(5,4,4,0)");
  g.fillStyle = pg;
  g.fillRect(0, 0, W, pupil * 1.25);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function buildEyes(setup: EyeSetup): Group {
  const group = new Group();
  group.name = "eyes";
  if (!setup.open) return group;
  const geo = new SphereGeometry(setup.radius, 48, 32);
  geo.rotateX(Math.PI / 2); // the +Y pole (texture top row) now looks down +Z
  const mat = new MeshPhysicalMaterial({
    map: eyeTexture(setup.iris),
    roughness: 0.32,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    ior: 1.376,
    specularIntensity: 0.6,
  });
  // The upper lid shades the top of the eyeball; the sockets darken the rim.
  mat.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEyeN;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvEyeN = normalize(position);");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEyeN;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        // Upper lid and lashes shade the top; the corners curve away into shadow;
        // a photographed white of the eye is never paper white.
        diffuseColor.rgb *= 1.0 - 0.6 * smoothstep(-0.12, 0.45, vEyeN.y);
        diffuseColor.rgb *= mix(0.5, 1.0, smoothstep(0.1, 0.75, vEyeN.z));
        diffuseColor.rgb *= mix(0.62, 1.0, 1.0 - smoothstep(0.25, 0.7, abs(vEyeN.x)));
        diffuseColor.rgb *= vec3(0.86, 0.8, 0.77);`,
      );
  };
  mat.customProgramCacheKey = () => "twinme-eye-v3";
  // Dark, fleshy socket behind each eyeball: any gap at the corners reads as
  // the caruncle in shadow instead of a hole into the head.
  const socketGeo = new SphereGeometry(setup.radius * 1.18, 24, 16);
  const socketMat = new MeshPhysicalMaterial({ color: new Color("#3a1d1a"), roughness: 0.55, side: BackSide });
  for (const c of setup.centres) {
    const m = new Mesh(geo, mat);
    m.position.copy(c);
    m.renderOrder = -1;
    const socket = new Mesh(socketGeo, socketMat);
    socket.position.copy(c).add(new Vector3(0, 0, -0.0015));
    group.add(m, socket);
  }
  return group;
}
