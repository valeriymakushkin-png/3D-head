"use client";

import type { Camera, Scene, WebGLRenderer } from "three";

/** Handle on the live studio renderer for DOM-side features (HD export). */
export const stageRef: { gl: WebGLRenderer | null; scene: Scene | null; camera: Camera | null } = {
  gl: null,
  scene: null,
  camera: null,
};
