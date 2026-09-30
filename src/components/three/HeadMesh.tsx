"use client";

import { useEffect, useMemo } from "react";
import type { BufferAttribute } from "three";
import type { Look } from "@/lib/avatar/look";
import type { HeadAsset } from "@/lib/head/asset";
import type { BeardParams, HairColorSpec, HairParams } from "@/lib/hair/params";
import { writeMasks } from "@/lib/three/masks";
import { applyEyeCut, createSkinMaterial, updateSkinUniforms } from "@/lib/three/skinMaterial";
import { eyeSetup } from "@/lib/three/eyes";

export interface SkinShade {
  vis: Uint8Array;
  ao: Uint8Array;
}

/** Writes baked light visibility / AO (from the engine) onto a head geometry. */
export function writeSkinShade(geometry: import("three").BufferGeometry, shade: SkinShade | null) {
  const vis = geometry.getAttribute("aLightVis") as BufferAttribute | undefined;
  const ao = geometry.getAttribute("aSkinAO") as BufferAttribute | undefined;
  if (!vis || !ao) return;
  if (shade && shade.vis.length === vis.array.length && shade.ao.length === ao.array.length) {
    (vis.array as Uint8Array).set(shade.vis);
    (ao.array as Uint8Array).set(shade.ao);
  } else {
    (vis.array as Uint8Array).fill(255);
    (ao.array as Uint8Array).fill(255);
  }
  vis.needsUpdate = true;
  ao.needsUpdate = true;
}

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
  skinShade = null,
  cloneGeometry = false,
}: {
  skinShade?: SkinShade | null;
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
    writeSkinShade(geometry, skinShade);
  }, [geometry, skinShade]);

  useEffect(() => {
    applyEyeCut(material, eyeSetup(asset.rig, asset.analysis.eyeColor));
  }, [material, asset]);

  useEffect(() => {
    updateSkinUniforms(material, look, asset.bakedBeard, hair, beard, hairColor);
  }, [material, look, asset, hair, beard, hairColor]);

  return <mesh name="head" geometry={geometry} material={material} castShadow receiveShadow />;
}
