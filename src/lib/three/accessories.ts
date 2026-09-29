import {
  CatmullRomCurve3,
  Color,
  Group,
  Mesh,
  MeshStandardMaterial,
  SphereGeometry,
  TorusGeometry,
  BoxGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import type { AccessoryId } from "@/lib/avatar/look";
import { type HeadRig, LM, lmk } from "@/lib/head/rig";

const gold = () => new MeshStandardMaterial({ color: new Color("#d8b577"), metalness: 1, roughness: 0.18 });
const silver = () => new MeshStandardMaterial({ color: new Color("#d9dbe0"), metalness: 1, roughness: 0.16 });

/** Earlobe estimate: below the tragus, just behind the jaw edge. */
function earlobe(rig: HeadRig, side: 1 | -1): Vector3 {
  const cheek = lmk(rig, side === 1 ? LM.cheekL : LM.cheekR);
  const nose = lmk(rig, LM.noseTip);
  return new Vector3(side * (Math.abs(cheek[0]) + 0.0045), nose[1] - 0.012, cheek[2] - 0.028);
}

export function buildAccessories(ids: AccessoryId[], rig: HeadRig): Group {
  const g = new Group();
  g.name = "accessories";
  for (const id of ids) {
    if (id === "stud_earrings") {
      for (const side of [1, -1] as const) {
        const m = new Mesh(new SphereGeometry(0.0022, 24, 16), silver());
        m.position.copy(earlobe(rig, side)).add(new Vector3(side * 0.001, 0, 0));
        g.add(m);
      }
    } else if (id === "hoop_earring") {
      const m = new Mesh(new TorusGeometry(0.0068, 0.0008, 12, 48), gold());
      const p = earlobe(rig, 1);
      m.position.copy(p).add(new Vector3(0.0012, -0.0062, 0));
      m.rotation.y = Math.PI / 2;
      g.add(m);
    } else if (id === "chain" || id === "signet_chain") {
      const chin = lmk(rig, LM.chin);
      const cy = chin[1] - 0.085;
      const pts: Vector3[] = [];
      for (let i = 0; i <= 64; i++) {
        const t = (i / 64) * Math.PI * 2;
        const front = Math.max(0, Math.cos(t));
        pts.push(new Vector3(Math.sin(t) * 0.066, cy - front * front * 0.03 + (1 - front) * 0.012, Math.cos(t) * 0.058 - 0.022));
      }
      const curve = new CatmullRomCurve3(pts, true);
      g.add(new Mesh(new TubeGeometry(curve, 256, 0.0014, 8, true), gold()));
      if (id === "signet_chain") {
        const tag = new Mesh(new BoxGeometry(0.012, 0.018, 0.0016), gold());
        const bottom = curve.getPointAt(0);
        tag.position.copy(bottom).add(new Vector3(0, -0.011, 0.003));
        tag.rotation.x = -0.25;
        g.add(tag);
      }
    }
  }
  return g;
}
