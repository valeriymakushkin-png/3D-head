"use client";

import {
  BufferAttribute,
  CanvasTexture,
  CustomBlending,
  DataTexture,
  HalfFloatType,
  LinearFilter,
  LinearMipmapLinearFilter,
  Matrix3,
  Matrix4,
  Mesh,
  NoBlending,
  OneFactor,
  OrthographicCamera,
  PlaneGeometry,
  RGBAFormat,
  RedFormat,
  Scene,
  ShaderMaterial,
  SRGBColorSpace,
  UnsignedByteType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  WebGLRenderer,
  AddEquation,
  DoubleSide,
  type BufferGeometry,
  type Texture,
} from "three";

/**
 * Multi-view texture baking on the GPU.
 *
 * For each photo we (1) rasterise the sculpted head from that photo's fitted
 * camera to get a depth map, then (2) rasterise the head in UV space and, per
 * texel, project into the photo, depth-test for occlusion, and accumulate the
 * colour weighted by: facing ratio³ (grazing texels are blurry), skin
 * segmentation (no hair/background/clothes smeared on the skull), image-edge
 * falloff and a per-view exposure gain. (3) A resolve pass normalises the sum
 * and fills unseen skin (back of neck, under hair) with the template's skin
 * micro-detail re-coloured to the user's measured skin tone.
 */

export interface BakeView {
  image: HTMLCanvasElement;
  width: number;
  height: number;
  /** head space → image space (x px right, y px up (negative), z px towards camera), 3×4 row-major. */
  affine: number[];
  /** Per-vertex 2D landmark residual correction (pixels). */
  residual: Float32Array;
  /** Skin probability (0..255), same size as the image. */
  skinMask: Uint8Array;
  gain: [number, number, number];
  weight: number;
  /** Weight multiplier inside the eye/mouth mask (1 for the front photo, ~0 for others). */
  featureKeep: number;
}

const common = /* glsl */ `
  uniform mat4 uAff;
  uniform vec2 uImg;
  uniform vec2 uZ;
  attribute vec2 aResid;
  vec3 toImage(vec3 p) {
    vec3 q = (uAff * vec4(p, 1.0)).xyz;
    q.xy += aResid;
    return q;
  }
  float zNorm(float z) { return clamp(1.0 - (z - uZ.x) / (uZ.y - uZ.x), 0.0, 1.0); }
`;

const depthVS = /* glsl */ `
  ${common}
  varying float vZ;
  void main() {
    vec3 q = toImage(position);
    vZ = zNorm(q.z);
    gl_Position = vec4(q.x / uImg.x * 2.0 - 1.0, 1.0 + 2.0 * q.y / uImg.y, vZ * 2.0 - 1.0, 1.0);
  }
`;
const depthFS = /* glsl */ `
  varying float vZ;
  void main() { gl_FragColor = vec4(vZ, 0.0, 0.0, 1.0); }
`;

const accumVS = /* glsl */ `
  ${common}
  uniform mat3 uNrm;
  attribute float aFeat;
  varying vec3 vImg;
  varying vec3 vN;
  varying float vZ;
  varying float vFeat;
  void main() {
    vec3 q = toImage(position);
    vImg = q;
    vFeat = aFeat;
    vN = uNrm * normal;
    vZ = zNorm(q.z);
    gl_Position = vec4(uv * 2.0 - 1.0, 0.0, 1.0);
  }
`;
const accumFS = /* glsl */ `
  uniform sampler2D uPhoto;
  uniform sampler2D uSeg;
  uniform sampler2D uDepth;
  uniform vec2 uImg;
  uniform vec3 uGain;
  uniform float uWeight;
  uniform float uFeatureKeep;
  varying vec3 vImg;
  varying vec3 vN;
  varying float vZ;
  varying float vFeat;
  void main() {
    vec2 t = vec2(vImg.x / uImg.x, -vImg.y / uImg.y);
    if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) discard;
    float dz = texture2D(uDepth, vec2(t.x, 1.0 - t.y)).r;
    float vis = 1.0 - smoothstep(0.002, 0.008, vZ - dz);
    vec3 n = normalize(vN);
    float facing = clamp(n.z, 0.0, 1.0);
    float seg = texture2D(uSeg, t).r;
    float edge = smoothstep(0.0, 0.04, min(min(t.x, 1.0 - t.x), min(t.y, 1.0 - t.y)));
    // Eyes and mouth come from one photo only: blending blinks and smiles ghosts.
    float feat = mix(1.0, uFeatureKeep, vFeat);
    float w = vis * facing * facing * facing * facing * seg * edge * uWeight * feat;
    vec3 c = texture2D(uPhoto, t).rgb * uGain;
    gl_FragColor = vec4(c * w, w);
  }
`;

const resolveFS = /* glsl */ `
  uniform sampler2D uAcc;
  uniform sampler2D uTemplate;
  uniform vec3 uSkinRatio;
  varying vec2 vUv;
  vec3 toSRGB(vec3 c) {
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
  }
  float lum(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }
  void main() {
    vec4 a = textureLod(uAcc, vUv, 0.0);
    vec3 proj = a.rgb / max(a.a, 1e-4);
    float k = smoothstep(0.03, 0.4, a.a);
    // Unseen skin (under a fringe, under the chin, the back of the head):
    // pull-push inpainting through the accumulator's mip chain, so the fill
    // continues the neighbouring *photographed* skin, lighting included…
    vec3 fill = texture2D(uTemplate, vUv).rgb * uSkinRatio;
    bool have = false;
    for (int l = 11; l >= 1; l--) {
      vec4 m = textureLod(uAcc, vUv, float(l));
      if (m.a < 1e-6) continue;
      vec3 c = m.rgb / m.a;
      fill = have ? mix(fill, c, smoothstep(0.01, 0.25, m.a)) : c;
      have = true;
    }
    // …re-textured with the template's pores and stubble (luminance detail only).
    float det = clamp(lum(texture2D(uTemplate, vUv).rgb) / max(lum(textureLod(uTemplate, vUv, 4.0).rgb), 1e-3), 0.72, 1.3);
    gl_FragColor = vec4(toSRGB(clamp(mix(fill * det, proj, k), 0.0, 1.0)), 1.0);
  }
`;

function affineToMat4(M: number[]) {
  return new Matrix4().set(M[0], M[1], M[2], M[3], M[4], M[5], M[6], M[7], M[8], M[9], M[10], M[11], 0, 0, 0, 1);
}

export interface BakeResult {
  canvas: HTMLCanvasElement;
  /** Fraction of atlas texels covered by photos. */
  coverage: number;
}

export function bakeTexture(
  geometry: BufferGeometry,
  views: BakeView[],
  templateAlbedo: Texture,
  skinRatio: [number, number, number],
  size = 2048,
): BakeResult {
  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: false });
  renderer.setPixelRatio(1);
  renderer.setSize(8, 8, false);
  renderer.autoClear = false;

  const acc = new WebGLRenderTarget(size, size, {
    type: HalfFloatType,
    format: RGBAFormat,
    depthBuffer: false,
    generateMipmaps: true, // the resolve pass inpaints through the mip chain
    minFilter: LinearMipmapLinearFilter,
    magFilter: LinearFilter,
  });
  renderer.setRenderTarget(acc);
  renderer.setClearColor(0x000000, 0);
  renderer.clear(true, false, false);

  const scene = new Scene();
  const cam = new OrthographicCamera(-1, 1, 1, -1, -1, 1);
  const mesh = new Mesh(geometry);
  mesh.frustumCulled = false;
  scene.add(mesh);
  const n = geometry.getAttribute("position").count;
  const residAttr = new BufferAttribute(new Float32Array(n * 2), 2);
  geometry.setAttribute("aResid", residAttr);

  // Uniform objects are created once and mutated per view (three binds the
  // uniforms object at program creation).
  const U = {
    uAff: { value: new Matrix4() },
    uImg: { value: new Vector2() },
    uZ: { value: new Vector2() },
    uNrm: { value: new Matrix3() },
    uPhoto: { value: null as Texture | null },
    uSeg: { value: null as Texture | null },
    uDepth: { value: null as Texture | null },
    uGain: { value: new Vector3(1, 1, 1) },
    uWeight: { value: 1 },
    uFeatureKeep: { value: 1 },
  };
  const depthMat = new ShaderMaterial({
    vertexShader: depthVS,
    fragmentShader: depthFS,
    side: DoubleSide,
    uniforms: { uAff: U.uAff, uImg: U.uImg, uZ: U.uZ },
  });
  const accumMat = new ShaderMaterial({
    uniforms: U,
    vertexShader: accumVS,
    fragmentShader: accumFS,
    side: DoubleSide,
    depthTest: false,
    depthWrite: false,
    blending: CustomBlending,
    blendEquation: AddEquation,
    blendSrc: OneFactor,
    blendDst: OneFactor,
    blendSrcAlpha: OneFactor,
    blendDstAlpha: OneFactor,
  });

  const pos = geometry.getAttribute("position");
  for (const v of views) {
    residAttr.array.set(v.residual);
    residAttr.needsUpdate = true;
    const aff = affineToMat4(v.affine);
    let zMin = Infinity,
      zMax = -Infinity;
    for (let i = 0; i < n; i++) {
      const z = v.affine[8] * pos.getX(i) + v.affine[9] * pos.getY(i) + v.affine[10] * pos.getZ(i) + v.affine[11];
      if (z < zMin) zMin = z;
      if (z > zMax) zMax = z;
    }
    U.uAff.value.copy(aff);
    U.uImg.value.set(v.width, v.height);
    U.uZ.value.set(zMin, zMax);

    // (1) depth from the photo's camera
    const depth = new WebGLRenderTarget(v.width, v.height, { type: HalfFloatType, format: RGBAFormat, depthBuffer: true });
    mesh.material = depthMat;
    renderer.setRenderTarget(depth);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear(true, true, false);
    renderer.render(scene, cam);

    // (2) accumulate into the atlas
    const photo = new CanvasTexture(v.image);
    photo.flipY = false;
    photo.colorSpace = SRGBColorSpace;
    photo.minFilter = LinearFilter;
    photo.generateMipmaps = false;
    const seg = new DataTexture(v.skinMask, v.width, v.height, RedFormat, UnsignedByteType);
    seg.flipY = false;
    seg.minFilter = LinearFilter;
    seg.magFilter = LinearFilter;
    seg.needsUpdate = true;
    U.uNrm.value.setFromMatrix4(aff).invert().transpose();
    U.uPhoto.value = photo;
    U.uSeg.value = seg;
    U.uDepth.value = depth.texture;
    U.uGain.value.set(...v.gain);
    U.uWeight.value = v.weight;
    U.uFeatureKeep.value = v.featureKeep;
    mesh.material = accumMat;
    renderer.setRenderTarget(acc);
    renderer.render(scene, cam);

    depth.dispose();
    photo.dispose();
    seg.dispose();
  }

  // (3) resolve to an sRGB 8-bit atlas
  const out = new WebGLRenderTarget(size, size, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false });
  const quad = new Mesh(
    new PlaneGeometry(2, 2),
    new ShaderMaterial({
      vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
      fragmentShader: resolveFS,
      uniforms: {
        uAcc: { value: acc.texture },
        uTemplate: { value: templateAlbedo },
        uSkinRatio: { value: new Vector3(...skinRatio) },
      },
      blending: NoBlending,
      depthTest: false,
    }),
  );
  const qs = new Scene();
  qs.add(quad);
  renderer.setRenderTarget(out);
  renderer.render(qs, cam);

  const pixels = new Uint8Array(size * size * 4);
  renderer.readRenderTargetPixels(out, 0, 0, size, size, pixels);

  // coverage from the accumulator alpha (thresholded into an 8-bit target)
  const accPx = new Uint8Array(64 * 64 * 4);
  const small = new WebGLRenderTarget(64, 64, { type: UnsignedByteType, format: RGBAFormat, depthBuffer: false });
  (quad.material as ShaderMaterial).dispose();
  quad.material = new ShaderMaterial({
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader:
      "uniform sampler2D uAcc; varying vec2 vUv; void main(){ gl_FragColor = vec4(step(0.1, texture2D(uAcc, vUv).a)); }",
    uniforms: { uAcc: { value: acc.texture } },
    blending: NoBlending,
  });
  renderer.setRenderTarget(small);
  renderer.render(qs, cam);
  renderer.readRenderTargetPixels(small, 0, 0, 64, 64, accPx);
  let covered = 0;
  for (let i = 0; i < 64 * 64; i++) if (accPx[i * 4 + 3] > 127) covered++;

  // GL rows are bottom-up; images are top-down (flipY=true on reload).
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const img = ctx.createImageData(size, size);
  const row = size * 4;
  for (let y = 0; y < size; y++) img.data.set(pixels.subarray((size - 1 - y) * row, (size - y) * row), y * row);
  ctx.putImageData(img, 0, 0);

  geometry.deleteAttribute("aResid");
  acc.dispose();
  out.dispose();
  small.dispose();
  depthMat.dispose();
  accumMat.dispose();
  renderer.dispose();
  renderer.forceContextLoss();
  return { canvas, coverage: covered / (64 * 64) };
}
