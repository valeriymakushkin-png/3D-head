"use client";

import { useEffect, useMemo } from "react";
import { Color, DoubleSide, MeshPhysicalMaterial } from "three";
import type { HeadAsset } from "@/lib/head/asset";

/**
 * A plain dark crew-neck, so the twin reads as a person rather than a bust.
 * It is the head/shoulder mesh itself pushed out along its normals, cut by a
 * collar plane in the fragment shader — a perfectly smooth neckline on any
 * twin, with no extra geometry to build or keep in sync.
 */
export function Shirt({ asset }: { asset: HeadAsset }) {
  const material = useMemo(() => {
    const chinY = asset.rig.landmarks[152 * 3 + 1];
    const m = new MeshPhysicalMaterial({
      color: new Color("#0e0e10"),
      roughness: 0.92,
      sheen: 0.55,
      sheenRoughness: 0.5,
      sheenColor: new Color("#3b3b40"),
      side: DoubleSide,
    });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uCollarY = { value: chinY - 0.072 };
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vHeadPos;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\ntransformed += objectNormal * 0.0065;\nvHeadPos = transformed;");
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying vec3 vHeadPos;\nuniform float uCollarY;")
        .replace(
          "#include <clipping_planes_fragment>",
          `#include <clipping_planes_fragment>
          // Neckline: a plane that rises towards the back of the neck.
          float collar = ( vHeadPos.y - uCollarY ) + 0.2 * ( vHeadPos.z - 0.08 );
          if ( collar > 0.0 ) discard;`,
        )
        .replace(
          "#include <color_fragment>",
          `#include <color_fragment>
          // A slightly lighter ribbed band along the neckline.
          diffuseColor.rgb *= 1.0 + 0.6 * smoothstep( -0.012, -0.002, collar );`,
        );
    };
    m.customProgramCacheKey = () => "twinme-shirt-v1";
    return m;
  }, [asset]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh name="shirt" geometry={asset.geometry} material={material} renderOrder={-1} />;
}
