"use client";

import { useEffect, useMemo, useState } from "react";
import type { Group } from "three";
import type { Look } from "@/lib/avatar/look";
import { avatarEngine } from "@/lib/engine/client";
import type { QualityTier } from "@/lib/engine/protocol";
import { bumpScene } from "@/lib/engine/sceneBus";
import type { StrandMeshData } from "@/lib/hair/generate";
import {
  type BeardParams,
  type HairParams,
  resolveBeardParams,
  resolveHairColor,
  resolveHairParams,
} from "@/lib/hair/params";
import type { HeadAsset } from "@/lib/head/asset";
import { buildAccessories } from "@/lib/three/accessories";
import { buildGlasses, disposeGroup } from "@/lib/three/glasses";
import { HeadMesh } from "@/components/three/HeadMesh";
import { StrandMesh } from "@/components/three/StrandMesh";

function useStrands(
  kind: "hair" | "beard",
  channel: string,
  asset: HeadAsset,
  params: HairParams | BeardParams | null,
  quality: QualityTier,
  onPending?: (pending: boolean) => void,
) {
  const [data, setData] = useState<StrandMeshData | null>(null);
  const key = params ? JSON.stringify(params) : "none";
  useEffect(() => {
    if (!params) {
      setData(null);
      return;
    }
    let alive = true;
    onPending?.(true);
    const job =
      kind === "hair"
        ? avatarEngine.hair(channel, asset, params as HairParams, quality)
        : avatarEngine.beard(channel, asset, params as BeardParams, quality);
    job
      .then((d) => {
        if (alive && d) setData(d);
      })
      .catch((e) => console.error(`[avatar] ${kind} generation failed`, e))
      .finally(() => alive && onPending?.(false));
    return () => {
      alive = false;
    };
    // `key` captures params by value
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind, channel, asset, key, quality]);
  return data;
}

export interface AvatarProps {
  asset: HeadAsset;
  look: Look;
  quality: QualityTier;
  /** Worker channel — separate channels never cancel each other. */
  channel?: string;
  /** For compare mode: give this instance its own mask buffers. */
  isolated?: boolean;
  onBusy?: (busy: boolean) => void;
}

export function Avatar({ asset, look, quality, channel = "main", isolated = false, onBusy }: AvatarProps) {
  const hairParams = useMemo(() => resolveHairParams(look.hair, asset.natural), [look.hair, asset.natural]);
  const hairColor = useMemo(() => resolveHairColor(look.hair, asset.natural), [look.hair, asset.natural]);
  const beardParams = useMemo(() => resolveBeardParams(look.beard), [look.beard]);

  const hair = useStrands("hair", channel, asset, hairParams, quality, onBusy);
  const beard = useStrands("beard", channel, asset, beardParams, quality);

  const glasses = useMemo<Group | null>(
    () => (look.glasses.style === "none" ? null : buildGlasses(look.glasses.style, asset.rig, look.glasses.tint)),
    [look.glasses.style, look.glasses.tint, asset.rig],
  );
  useEffect(() => () => {
    if (glasses) disposeGroup(glasses);
  }, [glasses]);

  const accessoriesKey = look.accessories.join(",");
  const accessories = useMemo(
    () => buildAccessories(look.accessories, asset.rig),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accessoriesKey, asset.rig],
  );
  useEffect(() => () => disposeGroup(accessories), [accessories]);

  useEffect(() => {
    bumpScene();
  }, [hair, beard, glasses, accessories, look.skin, hairColor]);

  return (
    <group name="avatar">
      <HeadMesh
        asset={asset}
        look={look}
        hair={hairParams}
        beard={beardParams}
        hairColor={hairColor}
        cloneGeometry={isolated}
      />
      <StrandMesh name="hair" data={hair} color={hairColor} center={asset.rig.center} />
      <StrandMesh name="beard" data={beardParams ? beard : null} color={hairColor} center={asset.rig.center} darken={0.85} />
      {glasses && <primitive object={glasses} />}
      <primitive object={accessories} />
    </group>
  );
}
