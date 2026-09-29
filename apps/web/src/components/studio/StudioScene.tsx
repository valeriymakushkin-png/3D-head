"use client";

import { Avatar } from "@/components/three/Avatar";
import { AvatarCanvas } from "@/components/three/AvatarCanvas";
import { CameraRig } from "@/components/three/CameraRig";
import { RenderPipeline } from "@/components/three/RenderPipeline";
import { StudioStage } from "@/components/three/Stage";
import { StageBinder } from "@/components/three/StageBinder";
import { useStudio } from "@/store/studio";

/** The 3D layer of the studio. The avatar is the product; everything else floats over it. */
export function StudioScene() {
  const asset = useStudio((s) => s.asset);
  const look = useStudio((s) => s.look);
  const quality = useStudio((s) => s.quality);
  const compare = useStudio((s) => s.compare);
  const setBusy = useStudio((s) => s.setBusy);

  return (
    <AvatarCanvas className="!absolute inset-0 touch-none" aria-label="Your 3D twin — drag to rotate, pinch or scroll to zoom">
      <StudioStage />
      <CameraRig />
      <StageBinder />
      {asset && (
        <>
          {compare ? (
            <>
              <group name="avatar-before">
                <Avatar asset={asset} look={compare.before} quality={quality} channel="before" />
              </group>
              <group name="avatar-after">
                <Avatar asset={asset} look={compare.after} quality={quality} channel="after" isolated onBusy={setBusy} />
              </group>
            </>
          ) : (
            <group name="avatar-main">
              <Avatar asset={asset} look={look} quality={quality} onBusy={setBusy} />
            </group>
          )}
          <RenderPipeline asset={asset} />
        </>
      )}
    </AvatarCanvas>
  );
}
