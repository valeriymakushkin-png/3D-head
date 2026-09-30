"use client";

import { Environment, Lightformer } from "@react-three/drei";
import { AMBIENT, STUDIO_LIGHTS } from "@/lib/three/lighting";

/**
 * Portrait studio: a large warm key softbox, cool fill, two kicker strips
 * behind the head for the cinematic rim, and a dark floor bounce. The same
 * lights drive the strand shader (lib/three/lighting.ts).
 */
export function StudioStage({ environmentIntensity = 0.55 }: { environmentIntensity?: number }) {
  return (
    <>
      {STUDIO_LIGHTS.map((l) => (
        <directionalLight key={l.name} position={l.position} color={l.color} intensity={l.intensity} />
      ))}
      <hemisphereLight args={[AMBIENT.top, AMBIENT.bottom, 0.35]} />
      <Environment resolution={256} frames={1} environmentIntensity={environmentIntensity}>
        <color attach="background" args={["#0b0a09"]} />
        <Lightformer form="rect" intensity={3} color="#fff3e6" position={[-2.2, 2, 3]} scale={[3, 2.2, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.9} color="#d9e4ff" position={[3, 0.3, 2.2]} scale={[2, 3, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={4} color="#eef3ff" position={[-2.6, 1, -2.8]} scale={[0.6, 4, 1]} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={3} color="#ffe6cf" position={[2.6, 1.2, -2.6]} scale={[0.6, 4, 1]} target={[0, 0, 0]} />
        <Lightformer form="circle" intensity={1.2} color="#ffffff" position={[0, 4, 0.5]} scale={2} target={[0, 0, 0]} />
        <Lightformer form="rect" intensity={0.35} color="#3a2a20" position={[0, -3, 1]} scale={[8, 2, 1]} target={[0, 0, 0]} />
      </Environment>
    </>
  );
}
