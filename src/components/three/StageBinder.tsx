"use client";

import { useThree } from "@react-three/fiber";
import { useEffect } from "react";
import { stageRef } from "@/lib/engine/stageRef";

/** Exposes the live renderer/scene/camera to DOM-side features (HD export). */
export function StageBinder() {
  const { gl, scene, camera } = useThree();
  useEffect(() => {
    stageRef.gl = gl;
    stageRef.scene = scene;
    stageRef.camera = camera;
    if (process.env.NODE_ENV !== "production") (window as unknown as { __stage: typeof stageRef }).__stage = stageRef;
    return () => {
      stageRef.gl = stageRef.scene = stageRef.camera = null;
    };
  }, [gl, scene, camera]);
  return null;
}
