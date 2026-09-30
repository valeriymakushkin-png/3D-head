import { Color, MeshPhysicalMaterial, ShaderChunk, type Texture, Vector2 } from "three";

/**
 * Skin diffuse with a subsurface approximation: light wraps past the
 * terminator per channel (red travels furthest in skin), so shadow edges go
 * warm and soft instead of grey — the single biggest "is it real" cue.
 */
const SKIN_DIRECT = ShaderChunk.lights_physical_pars_fragment.replace(
  "reflectedLight.directDiffuse += irradiance * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );",
  `{
    float nlRaw = dot( geometryNormal, directLight.direction );
    vec3 wrapW = vec3( 0.38, 0.2, 0.15 );
    vec3 sss = clamp( ( vec3( nlRaw ) + wrapW ) / ( 1.0 + wrapW ), 0.0, 1.0 );
    sss = mix( vec3( saturate( nlRaw ) ), sss * sss * ( 1.0 + wrapW * 0.6 ), 0.65 );
    reflectedLight.directDiffuse += sss * directLight.color * BRDF_Lambert( material.diffuseContribution ) * ( 1.0 - F );
  }`,
);

/** The directional-light loop, with each light scaled by its baked visibility. */
const SKIN_LIGHTS_BEGIN = ShaderChunk.lights_fragment_begin.replace(
  "getDirectionalLightInfo( directionalLight, directLight );",
  "getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= lightVis( UNROLLED_LOOP_INDEX );",
);
if (process.env.NODE_ENV !== "production" && (SKIN_DIRECT === ShaderChunk.lights_physical_pars_fragment || SKIN_LIGHTS_BEGIN === ShaderChunk.lights_fragment_begin)) {
  console.warn("[skin] three.js shader chunks changed — skin lighting patches not applied");
}

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
  uEyeOpen: { value: number };
  uEyeR: { value: Vector2[] };
  uEyeL: { value: Vector2[] };
  uEyeZ: { value: number };
}

export type SkinMaterial = MeshPhysicalMaterial & { userData: { uniforms: SkinUniforms } };

export function createSkinMaterial(map: Texture, normalMap: Texture | null, skinColor: Color): SkinMaterial {
  const mat = new MeshPhysicalMaterial({
    map,
    normalMap: normalMap ?? undefined,
    normalScale: new Vector2(0.55, 0.55),
    roughness: 0.5,
    metalness: 0,
    specularIntensity: 0.5,
    sheen: 0.3,
    sheenRoughness: 0.5,
    sheenColor: new Color("#ffcdb8"),
    // Second, sharper specular lobe: the thin oil layer on real skin.
    clearcoat: 0.14,
    clearcoatRoughness: 0.34,
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
    uEyeOpen: { value: 0 },
    uEyeR: { value: Array.from({ length: 16 }, () => new Vector2()) },
    uEyeL: { value: Array.from({ length: 16 }, () => new Vector2()) },
    uEyeZ: { value: 1 },
  };
  mat.userData.uniforms = uniforms;

  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        "#include <common>",
        "#include <common>\nattribute vec4 aMask;\nattribute vec4 aLightVis;\nattribute float aSkinAO;\nvarying vec4 vMask;\nvarying vec4 vLightVis;\nvarying float vSkinAO;\nvarying vec3 vHeadPos;",
      )
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvMask = aMask;\nvLightVis = aLightVis;\nvSkinAO = aSkinAO;\nvHeadPos = position;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <lights_physical_pars_fragment>", SKIN_DIRECT)
      // Open the eyes: cut the palpebral fissure along the user's own lid contour.
      .replace(
        "#include <clipping_planes_fragment>",
        `#include <clipping_planes_fragment>
        if ( uEyeOpen > 0.5 && vHeadPos.z > uEyeZ && ( inEye( vHeadPos.xy, uEyeR ) || inEye( vHeadPos.xy, uEyeL ) ) ) discard;`,
      )
      // Baked visibility of each studio light: groom shadows + the head's own soft shadows.
      .replace("#include <lights_fragment_begin>", SKIN_LIGHTS_BEGIN)
      .replace(
        "#include <aomap_fragment>",
        `#include <aomap_fragment>
        reflectedLight.indirectDiffuse *= vSkinAO;
        reflectedLight.indirectSpecular *= mix( 1.0, vSkinAO, 0.85 );`,
      )
      .replace(
        "#include <common>",
        `#include <common>
        varying vec4 vLightVis;
        varying float vSkinAO;
        varying vec3 vHeadPos;
        uniform float uEyeOpen;
        uniform vec2 uEyeR[16];
        uniform vec2 uEyeL[16];
        uniform float uEyeZ;
        bool inEye( vec2 p, vec2 poly[16] ) {
          bool c = false;
          for ( int i = 0, j = 15; i < 16; j = i++ ) {
            vec2 a = poly[i], b = poly[j];
            if ( ( a.y > p.y ) != ( b.y > p.y ) && p.x < ( b.x - a.x ) * ( p.y - a.y ) / ( b.y - a.y + 1e-9 ) + a.x ) c = !c;
          }
          return c;
        }
        float lightVis( const in int i ) {
          float v = i == 0 ? vLightVis.x : i == 1 ? vLightVis.y : i == 2 ? vLightVis.z : i == 3 ? vLightVis.w : 1.0;
          return 0.06 + 0.94 * v;
        }
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
  mat.customProgramCacheKey = () => "twinme-skin-v3";
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
  // (older twins may carry a NaN here, which would black out the whole skin)
  u.uBeardRemove.value = wantsLess && Number.isFinite(bakedBeard) ? Math.min(1, bakedBeard * 2.2) : 0;
  u.uBeardShadow.value = beard ? beard.shadow : 0;
  const root = new Color(hairColor.root);
  u.uBeardColor.value.setRGB(0.35 + root.r * 0.9, 0.3 + root.g * 0.9, 0.28 + root.b * 0.9);
  u.uHairColor.value.set(hairColor.root);
  u.uScalpCover.value = hair ? 0.72 : 0;
}

/** Cuts the eye openings for a twin captured with open eyes (see lib/three/eyes.ts). */
export function applyEyeCut(mat: SkinMaterial, eyes: import("@/lib/three/eyes").EyeSetup) {
  const u = mat.userData.uniforms;
  u.uEyeOpen.value = eyes.open ? 1 : 0;
  u.uEyeZ.value = eyes.cutZ;
  eyes.contours[0].forEach((p, i) => u.uEyeR.value[i].copy(p));
  eyes.contours[1].forEach((p, i) => u.uEyeL.value[i].copy(p));
}
