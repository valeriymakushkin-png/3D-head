"use client";

import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import { BufferAttribute, BufferGeometry, type Mesh, type PerspectiveCamera, Sphere, Vector2, Vector3 } from "three";
import type { StrandMeshData } from "@/lib/hair/generate";
import type { HairColorSpec } from "@/lib/hair/params";
import { createHairMaterial, setHairColor } from "@/lib/three/hairMaterial";

const size = new Vector2();

export function strandGeometry(data: StrandMeshData): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute("position", new BufferAttribute(data.position, 3));
  g.setAttribute("aTangent", new BufferAttribute(data.tangent, 3, true));
  g.setAttribute("aHair", new BufferAttribute(data.attr, 4, true));
  g.setAttribute("aShade", new BufferAttribute(data.shade ?? new Uint8Array((data.position.length / 3) * 4).fill(255), 4, true));
  g.setIndex(new BufferAttribute(data.index, 1));
  g.computeBoundingSphere();
  if (!g.boundingSphere || Number.isNaN(g.boundingSphere.radius)) g.boundingSphere = new Sphere(new Vector3(), 0.5);
  return g;
}

export function StrandMesh({
  data,
  color,
  center,
  darken = 1,
  name,
}: {
  data: StrandMeshData | null;
  color: HairColorSpec;
  center: [number, number, number];
  darken?: number;
  name: string;
}) {
  const material = useMemo(() => createHairMaterial(), []);
  const geometry = useMemo(() => (data && data.strandCount > 0 ? strandGeometry(data) : null), [data]);
  const ref = useRef<Mesh>(null);

  useEffect(() => () => geometry?.dispose(), [geometry]);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    setHairColor(material, color, darken);
  }, [material, color, darken]);
  useEffect(() => {
    material.uniforms.uCenter.value.set(...center);
    if (data) material.uniforms.uWidth.value = data.strandWidth;
  }, [material, center, data]);

  useFrame(({ camera, gl }) => {
    const cam = camera as PerspectiveCamera;
    gl.getDrawingBufferSize(size);
    material.uniforms.uPixelSize.value = (2 * Math.tan(((cam.fov ?? 30) * Math.PI) / 360)) / Math.max(1, size.y);
  });

  if (!geometry) return null;
  return <mesh ref={ref} name={name} geometry={geometry} material={material} frustumCulled={false} />;
}
