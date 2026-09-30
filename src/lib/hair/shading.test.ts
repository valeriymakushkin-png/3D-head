import { describe, expect, it } from "vitest";
import type { StrandMeshData } from "@/lib/hair/generate";
import type { SdfGrid } from "@/lib/hair/sdf";
import { buildDensity, emptyDensity, shadeSkin, shadeStrands } from "@/lib/hair/shading";

/** Signed distance grid of a sphere (radius r, centred at the origin). */
function sphereSdf(r: number, half = 0.2, cell = 0.004): SdfGrid {
  const n = Math.round((2 * half) / cell) + 1;
  const data = new Float32Array(n * n * n);
  for (let k = 0; k < n; k++)
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const x = -half + i * cell,
          y = -half + j * cell,
          z = -half + k * cell;
        data[i + n * (j + n * k)] = Math.hypot(x, y, z) - r;
      }
  return { min: [-half, -half, -half], cell, dims: [n, n, n], data };
}

/** A slab of straight strands running along +x, stacked in layers along +z (towards the light). */
function slab(layers: number, perLayer: number, z0: number): StrandMeshData {
  const K = 5;
  const S = layers * perLayer;
  const position = new Float32Array(S * K * 2 * 3);
  const attr = new Uint8Array(S * K * 2 * 4);
  let s = 0;
  for (let l = 0; l < layers; l++)
    for (let p = 0; p < perLayer; p++, s++)
      for (let k = 0; k < K; k++)
        for (let side = 0; side < 2; side++) {
          const v = (s * K + k) * 2 + side;
          position[v * 3] = -0.02 + (k / (K - 1)) * 0.04;
          position[v * 3 + 1] = -0.02 + (p / perLayer) * 0.04;
          position[v * 3 + 2] = z0 + l * 0.0015;
        }
  return {
    position,
    tangent: new Int16Array(position.length),
    attr,
    index: new Uint32Array(0),
    strandCount: S,
    pointsPerStrand: K,
    strandWidth: 0.0004,
  };
}

const vis = (shade: Uint8Array, strand: number, K: number, light: number) => shade[(strand * K * 2 + 4) * 4 + light] / 255;

describe("baked hair lighting", () => {
  const farAway: SdfGrid = sphereSdf(0.01, 0.05); // a tiny "head" nowhere near the groom
  const toLight: Array<[number, number, number]> = [
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ];

  it("strands deep in the groom are darker than the outer layer", () => {
    const d = slab(12, 40, 0.3);
    const grid = buildDensity(d);
    const shade = shadeStrands(d, grid, farAway, toLight, [0, 0, 0]);
    const inner = vis(shade, 0, d.pointsPerStrand, 0); // first layer: furthest from the light
    const outer = vis(shade, 11 * 40, d.pointsPerStrand, 0); // last layer: nearest the light
    expect(outer).toBeGreaterThan(0.9);
    expect(inner).toBeLessThan(outer - 0.3);
  });

  it("the head blocks light coming from behind it", () => {
    const d = slab(1, 20, 0.06); // a thin groom just in front of the head (+z)
    const head = sphereSdf(0.05);
    const grid = buildDensity(d);
    const fromBehind: Array<[number, number, number]> = [
      [0, 0, -1],
      [0, 0, 1],
      [0, 0, -1],
      [0, 0, 1],
    ];
    const shade = shadeStrands(d, grid, head, fromBehind, [0, 0, 0]);
    expect(vis(shade, 10, d.pointsPerStrand, 0)).toBeLessThan(0.1);
    expect(vis(shade, 10, d.pointsPerStrand, 1)).toBeGreaterThan(0.9);
  });

  it("skin under a groom gets less ambient light than bare skin", () => {
    const head = sphereSdf(0.05);
    const positions = new Float32Array([0, 0, 0.05, 0, -0.05, 0]);
    const normals = new Float32Array([0, 0, 1, 0, -1, 0]);
    const covered = slab(10, 40, 0.052);
    const bare = shadeSkin(positions, normals, emptyDensity(), head, toLight);
    const withHair = shadeSkin(positions, normals, buildDensity(covered), head, toLight);
    expect(withHair.ao[0]).toBeLessThan(bare.ao[0]);
    expect(withHair.vis[0]).toBeLessThan(bare.vis[0]);
    // the underside, facing away from the light, is unaffected by the groom above
    expect(withHair.ao[1]).toBe(bare.ao[1]);
  });
});
