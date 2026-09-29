"use client";

import type { ViewId } from "@/store/studio";

/** DOM canvases that receive the live orthogonal previews. */
export const previewTargets = new Map<Exclude<ViewId, "three_quarter">, HTMLCanvasElement>();

export const PREVIEW_VIEWS: Array<{ id: Exclude<ViewId, "three_quarter">; label: string; azimuth: number }> = [
  { id: "front", label: "Front", azimuth: 0 },
  { id: "left", label: "Left", azimuth: Math.PI / 2 },
  { id: "right", label: "Right", azimuth: -Math.PI / 2 },
  { id: "back", label: "Back", azimuth: Math.PI },
];

export const CAMERA_TARGET: [number, number, number] = [0, -0.035, 0.01];
