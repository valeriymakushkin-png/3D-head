import { Color, ShaderMaterial, Vector3 } from "three";
import type { HairColorSpec } from "@/lib/hair/params";
import { lightUniforms } from "@/lib/three/lighting";

/**
 * Strand shader: camera-facing ribbons with a dual-lobe Kajiya–Kay specular
 * (primary white lobe shifted to the root, secondary tinted lobe shifted to
 * the tip, as in Marschner's R / TRT), wrap diffuse against a volumetric
 * normal, back-scatter for rim-lit silhouettes, and root occlusion.
 * Tips use alpha-to-coverage on the MSAA framebuffer, so sub-pixel strands
 * fade out instead of aliasing — no sorting required.
 */
const vertexShader = /* glsl */ `
  attribute vec3 aTangent;
  attribute vec4 aHair; // t, side, rand, layer
  uniform float uWidth;
  uniform float uPixelSize; // world size of one pixel at distance 1
  varying vec3 vT;
  varying vec3 vWorld;
  varying float vt;
  varying float vRand;
  varying float vLayer;
  varying float vCoverage;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main() {
    vec4 world = modelMatrix * vec4(position, 1.0);
    vec3 T = normalize(mat3(modelMatrix) * aTangent);
    vec3 V = normalize(cameraPosition - world.xyz);
    vec3 S = cross(T, V);
    float sl = length(S);
    S = sl > 1e-4 ? S / sl : vec3(1.0, 0.0, 0.0);
    float t = aHair.x;
    float w = uWidth * (1.0 - 0.82 * pow(t, 1.5)) * (0.75 + 0.5 * aHair.z);
    float dist = length(cameraPosition - world.xyz);
    float minW = uPixelSize * dist * 0.85;
    float wEff = max(w, minW);
    vCoverage = clamp(w / wEff, 0.0, 1.0);
    world.xyz += S * (aHair.y * 2.0 - 1.0) * wEff * 0.5;
    vWorld = world.xyz;
    vT = T;
    vt = t;
    vRand = aHair.z;
    vLayer = aHair.w;
    gl_Position = projectionMatrix * viewMatrix * world;
    #include <logdepthbuf_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uRoot;
  uniform vec3 uTip;
  uniform vec3 uAlt;
  uniform float uAltShare;
  uniform float uShine;
  uniform vec3 uCenter;
  uniform vec3 uLightDir[4];
  uniform vec3 uLightCol[4];
  uniform vec3 uAmbientTop;
  uniform vec3 uAmbientBottom;
  uniform float uOpacity;
  varying vec3 vT;
  varying vec3 vWorld;
  varying float vt;
  varying float vRand;
  varying float vLayer;
  varying float vCoverage;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main() {
    #include <logdepthbuf_fragment>
    vec3 T = normalize(vT);
    vec3 V = normalize(cameraPosition - vWorld);
    vec3 N = normalize(vWorld - uCenter);
    float tone = 0.78 + 0.44 * vRand;
    vec3 base = mix(uRoot, uTip, smoothstep(0.05, 1.0, vt));
    if (fract(vRand * 7.31) < uAltShare) base = uAlt;
    base *= tone;
    float ao = mix(0.32, 1.0, smoothstep(0.0, 0.6, vt)) * mix(0.66, 1.0, vLayer);
    vec3 col = mix(uAmbientBottom, uAmbientTop, N.y * 0.5 + 0.5) * base * ao * 1.5;
    vec3 T1 = normalize(T + N * 0.1);
    vec3 T2 = normalize(T - N * 0.14);
    for (int i = 0; i < 4; i++) {
      vec3 L = uLightDir[i];
      float wrap = clamp((dot(N, L) + 0.5) / 1.5, 0.0, 1.0);
      vec3 H = normalize(L + V);
      float d1 = dot(T1, H);
      float d2 = dot(T2, H);
      float s1 = pow(sqrt(max(0.0, 1.0 - d1 * d1)), 220.0);
      float s2 = pow(sqrt(max(0.0, 1.0 - d2 * d2)), 48.0);
      float back = pow(clamp(dot(-L, V), 0.0, 1.0), 3.0) * (1.0 - 0.4 * vLayer);
      vec3 spec = (vec3(s1) * 0.22 + s2 * base * 1.0) * uShine;
      col += uLightCol[i] * ((base * wrap + spec * wrap) * ao + base * back * 0.9 * ao);
    }
    float alpha = vCoverage * (1.0 - smoothstep(0.78, 1.0, vt) * 0.65) * uOpacity;
    gl_FragColor = vec4(col, alpha);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;

export function createHairMaterial() {
  const mat = new ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms: {
      uWidth: { value: 0.0004 },
      uPixelSize: { value: 0.001 },
      uRoot: { value: new Color("#1c110a") },
      uTip: { value: new Color("#3d2718") },
      uAlt: { value: new Color("#000000") },
      uAltShare: { value: 0 },
      uShine: { value: 0.8 },
      uCenter: { value: new Vector3() },
      uOpacity: { value: 1 },
      ...lightUniforms(),
    },
  });
  mat.alphaToCoverage = true;
  return mat;
}

export function setHairColor(mat: ShaderMaterial, c: HairColorSpec, darken = 1) {
  (mat.uniforms.uRoot.value as Color).set(c.root).multiplyScalar(darken);
  (mat.uniforms.uTip.value as Color).set(c.tip).multiplyScalar(darken);
  if (c.alt) {
    (mat.uniforms.uAlt.value as Color).set(c.alt.color);
    mat.uniforms.uAltShare.value = c.alt.share;
  } else {
    mat.uniforms.uAltShare.value = 0;
  }
  mat.uniforms.uShine.value = c.shine;
}
