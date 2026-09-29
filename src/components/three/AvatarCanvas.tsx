"use client";

import { Canvas, type CanvasProps } from "@react-three/fiber";
import { NeutralToneMapping } from "three";

/**
 * Canvas defaults shared by the studio, landing hero and Telegram app:
 * MSAA (required for alpha-to-coverage hair), Khronos PBR Neutral tone
 * mapping (hue-preserving — critical for honest skin colour), capped DPR.
 */
export function AvatarCanvas({ children, ...props }: CanvasProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance", preserveDrawingBuffer: false }}
      camera={{ fov: 24, near: 0.02, far: 30, position: [0, 0.01, 0.86] }}
      onCreated={({ gl }) => {
        gl.toneMapping = NeutralToneMapping;
        gl.toneMappingExposure = 1.0;
      }}
      {...props}
    >
      {children}
    </Canvas>
  );
}
