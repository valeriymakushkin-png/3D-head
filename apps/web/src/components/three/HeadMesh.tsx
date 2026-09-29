"use client";

import { useEffect, useMemo } from "react";
import type { BufferAttribute } from "three";
import type { Look } from "@/lib/avatar/look";
import type { HeadAsset } from "@/lib/head/asset";
import type { BeardParams, HairColorSpec, HairParams } from "@/lib/hair/params";
import { writeMasks } from "@/lib/three/masks";
import { createSkinMaterial, updateSkinUniforms } from "@/lib/three/skinMaterial";

/**
 * The head surface. Geometry is shared between every Avatar instance of the
 * same asset (main view, compare view); each instance owns its material so
 * before/after can differ in skin, stubble shadow and scalp density.
 *
 * Masks live on the shared geometry, so for compare mode the "after" avatar
 * clones the geometry (cheap: 9k vertices).
 */
export function HeadMesh({
  asset,
  look,
  hair,
  beard,
  hairColor,
  cloneGeometry = false,
}: {
  asset: HeadAsset;
  look: Look;
  hair: HairParams | null;
  beard: BeardParams | null;
  hairColor: HairColorSpec;
  cloneGeometry?: boolean;
}) {
  const geometry = useMemo(() => (cloneGeometry ? asset.geometry.clone() : asset.geometry), [asset, cloneGeometry]);
  const material = useMemo(() => createSkinMaterial(asset.albedo, asset.normalMap, asset.skinColor), [asset]);

  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => () => {
    if (cloneGeometry) geometry.dispose();
  }, [geometry, cloneGeometry]);

  useEffect(() => {
    writeMasks(
      geometry.getAttribute("aMask") as BufferAttribute,
      geometry.getAttribute("position").array,
      asset.rig,
      asset.statics,
      hair,
      beard,
    );
  }, [geometry, asset, hair, beard]);

  useEffect(() => {
    updateSkinUniforms(material, look, asset.bakedBeard, hair, beard, hairColor);
  }, [material, look, asset, hair, beard, hairColor]);

  return <mesh name="head" geometry={geometry} material={material} castShadow receiveShadow />;
}
