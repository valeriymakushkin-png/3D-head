"use client";

import { CameraControls } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef } from "react";
import { Box3, MathUtils, Vector3 } from "three";
import type CameraControlsImpl from "camera-controls";
import { CAMERA_TARGET } from "@/lib/engine/previews";
import { useStudio, type ViewId } from "@/store/studio";

const VIEW_AZIMUTH: Record<ViewId, number> = {
  front: 0,
  left: Math.PI / 2,
  right: -Math.PI / 2,
  back: Math.PI,
  three_quarter: MathUtils.degToRad(32),
};

/**
 * Cinematic orbit camera: critically-damped motion, dolly-to-cursor zoom,
 * soft limits so the head can never leave frame, and fly-to presets for
 * the preview tiles. Distance is chosen so the head fills ~75 % of the
 * viewport on any aspect ratio.
 */
export function CameraRig({ intro = true }: { intro?: boolean }) {
  const ref = useRef<CameraControlsImpl>(null);
  const { size, camera } = useThree();
  const view = useStudio((s) => s.view);
  const turntable = useStudio((s) => s.turntable);

  const fitDistance = () => {
    const fov = MathUtils.degToRad((camera as { fov?: number }).fov ?? 24);
    const aspect = size.width / Math.max(1, size.height);
    // chin→crown + hair ≈ 0.28 m should span ~62 % of the height; the rest
    // of the 75 % "avatar zone" is neck and shoulders under the dock.
    const headH = 0.46;
    const headW = 0.36;
    const dH = headH / 2 / Math.tan(fov / 2);
    const dW = headW / 2 / (Math.tan(fov / 2) * aspect);
    return Math.max(dH, dW);
  };

  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    c.setBoundary(new Box3(new Vector3(-0.12, -0.2, -0.12), new Vector3(0.12, 0.12, 0.14)));
    // Lift the subject so the head sits above the style dock.
    c.setFocalOffset(0, 0.055, 0, false);
    const d = fitDistance();
    const az = VIEW_AZIMUTH.three_quarter;
    if (intro) {
      c.setLookAt(Math.sin(az + 0.9) * d * 1.6, 0.12, Math.cos(az + 0.9) * d * 1.6, ...CAMERA_TARGET, false);
    }
    c.setLookAt(Math.sin(az) * d, 0.02, Math.cos(az) * d, ...CAMERA_TARGET, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = ref.current;
    if (!c || view.nonce === 0) return;
    const d = fitDistance();
    const az = VIEW_AZIMUTH[view.id];
    c.setLookAt(Math.sin(az) * d, 0.01, Math.cos(az) * d, ...CAMERA_TARGET, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view]);

  useFrame((_, dt) => {
    if (turntable && ref.current) ref.current.azimuthAngle += dt * 0.35;
  });

  return (
    <CameraControls
      ref={ref}
      makeDefault
      smoothTime={0.32}
      draggingSmoothTime={0.12}
      minDistance={0.34}
      maxDistance={1.9}
      minPolarAngle={0.35}
      maxPolarAngle={2.2}
      dollyToCursor
      azimuthRotateSpeed={0.55}
      polarRotateSpeed={0.55}
      dollySpeed={0.6}
      truckSpeed={0.8}
    />
  );
}
