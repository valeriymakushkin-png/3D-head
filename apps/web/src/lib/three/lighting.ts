import { Color, Vector3 } from "three";

/**
 * One studio light rig shared by the physically based head material (through
 * real three.js lights) and the custom strand shader (through uniforms), so
 * hair and skin always agree on where the light comes from.
 *
 * Positions are in head space (metres): +Z faces the camera at rest.
 */
export interface StudioLight {
  name: string;
  position: [number, number, number];
  color: string;
  intensity: number;
}

export const STUDIO_LIGHTS: StudioLight[] = [
  { name: "key", position: [-1.1, 1.25, 1.5], color: "#fff4ea", intensity: 2.4 },
  { name: "fill", position: [1.5, 0.15, 1.2], color: "#dbe6ff", intensity: 0.55 },
  { name: "rimLeft", position: [-1.35, 0.8, -1.5], color: "#e6eeff", intensity: 2.6 },
  { name: "rimRight", position: [1.45, 0.95, -1.35], color: "#ffe7d1", intensity: 2.1 },
];

export const AMBIENT = { top: "#2b2f38", bottom: "#120f0e" };

/** Uniform arrays for the strand shader (linear colour space). */
export function lightUniforms() {
  return {
    uLightDir: { value: STUDIO_LIGHTS.map((l) => new Vector3(...l.position).normalize()) },
    uLightCol: { value: STUDIO_LIGHTS.map((l) => new Color(l.color).multiplyScalar(l.intensity * 0.3)) },
    uAmbientTop: { value: new Color(AMBIENT.top) },
    uAmbientBottom: { value: new Color(AMBIENT.bottom) },
  };
}
