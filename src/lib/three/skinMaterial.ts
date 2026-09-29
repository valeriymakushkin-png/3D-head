import { Color, MeshPhysicalMaterial, type Texture, Vector2 } from "three";

/**
 * Physically based skin with appearance controls injected into three's
 * standard physical shader (so it keeps IBL, sheen and all light types):
 *
 *   aMask.x  active beard mask      → stubble shadow under facial hair
 *   aMask.y  beard zone             → removes captured beard for "clean shave"
 *   aMask.z  scalp coverage         → darkens scalp under hair like real density
 *   aMask.w  facial features        → protects eyes/brows/lips from smoothing
 */
export interface SkinUniforms {
  uTan: { value: number };
  uComplexion: { value: number };
  uBeardShadow: { value: number };
  uBeardColor: { value: Color };
  uBeardRemove: { value: number };
  uSkinColor: { value: Color };
  uScalpCover: { value: number };
  uHairColor: { value: Color };
}

export type SkinMaterial = MeshPhysicalMaterial & { userData: { uniforms: SkinUniforms } };

export function createSkinMaterial(map: Texture, normalMap: Texture | null, skinColor: Color): SkinMaterial {
  const mat = new MeshPhysicalMaterial({
    map,
    normalMap: normalMap ?? undefined,
    normalScale: new Vector2(0.55, 0.55),
    roughness: 0.52,
    metalness: 0,
    specularIntensity: 0.55,
    sheen: 0.35,
    sheenRoughness: 0.55,
    sheenColor: new Color("#ffcdb8"),
  }) as SkinMaterial;

  const uniforms: SkinUniforms = {
    uTan: { value: 0 },
    uComplexion: { value: 0 },
    uBeardShadow: { value: 0 },
    uBeardColor: { value: new Color("#3a2a20") },
    uBeardRemove: { value: 0 },
    uSkinColor: { value: skinColor.clone() },
    uScalpCover: { value: 0 },
    uHairColor: { value: new Color("#1c110a") },
  };
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aMask;\nvarying vec4 vMask;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMask = aMask;");
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
        varying vec4 vMask;
        uniform float uTan;
        uniform float uComplexion;
        uniform float uBeardShadow;
        uniform vec3 uBeardColor;
        uniform float uBeardRemove;
        uniform vec3 uSkinColor;
        uniform float uScalpCover;
        uniform vec3 uHairColor;`,
      )
      .replace(
        "#include <map_fragment>",
        `#include <map_fragment>
        #ifdef USE_MAP
        {
          vec3 low = textureLod(map, vMapUv, 4.0).rgb;
          float lum = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
          float lowLum = max(dot(low, vec3(0.299, 0.587, 0.114)), 1e-3);
          float detail = lum / lowLum;
          // Clean shave: rebuild skin in the beard zone from the mean skin
          // colour + the local high-frequency detail (keeps pores, drops hair).
          float remove = vMask.y * uBeardRemove;
          vec3 shaved = uSkinColor * mix(1.0, clamp(detail, 0.85, 1.15), 0.6);
          diffuseColor.rgb = mix(diffuseColor.rgb, shaved, remove);
          // Complexion: even out tone and blemishes, keep features crisp.
          float smoothAmt = uComplexion * (1.0 - vMask.w);
          vec3 mid = textureLod(map, vMapUv, 2.5).rgb;
          vec3 even = mix(mid, uSkinColor, 0.35);
          diffuseColor.rgb = mix(diffuseColor.rgb, mix(diffuseColor.rgb, even, 0.7), smoothAmt);
          diffuseColor.rgb *= 1.0 + 0.04 * smoothAmt;
          // Tan: melanin-like absorption, stronger in red-poor channels.
          diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.64, 0.5), uTan);
          // Stubble shadow and scalp density.
          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uBeardColor, vMask.x * uBeardShadow);
          // Multiplicative so skin detail survives: reads as follicles/shadow, not paint.
          vec3 scalpTint = mix(vec3(1.0), uHairColor * 1.6 + 0.08, vMask.z * uScalpCover);
          diffuseColor.rgb *= scalpTint;
        }
        #endif`,
      )
      .replace(
        "#include <roughnessmap_fragment>",
        `#include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.72, vMask.z * uScalpCover);
        roughnessFactor = mix(roughnessFactor, roughnessFactor * 0.92, uComplexion * (1.0 - vMask.w));`,
      );
  };
  mat.customProgramCacheKey = () => "twinme-skin-v1";
  return mat;
}

/** Maps a Look onto the skin uniforms (shared by the studio and thumbnails). */
export function updateSkinUniforms(
  mat: SkinMaterial,
  look: import("@/lib/avatar/look").Look,
  bakedBeard: number,
  hair: import("@/lib/hair/params").HairParams | null,
  beard: import("@/lib/hair/params").BeardParams | null,
  hairColor: import("@/lib/hair/params").HairColorSpec,
) {
  const u = mat.userData.uniforms;
  u.uTan.value = look.skin.tone === "tanned" ? 0.55 : 0;
  u.uComplexion.value = look.skin.complexion;
  // Remove a captured beard whenever the chosen beard is lighter than it.
  const wantsLess = look.beard.style === "clean" || look.beard.style === "stubble" || look.beard.style === "goatee";
  u.uBeardRemove.value = wantsLess ? Math.min(1, bakedBeard * 2.2) : 0;
  u.uBeardShadow.value = beard ? beard.shadow : 0;
  const root = new Color(hairColor.root);
  u.uBeardColor.value.setRGB(0.35 + root.r * 0.9, 0.3 + root.g * 0.9, 0.28 + root.b * 0.9);
  u.uHairColor.value.set(hairColor.root);
  u.uScalpCover.value = hair ? 0.72 : 0;
}
