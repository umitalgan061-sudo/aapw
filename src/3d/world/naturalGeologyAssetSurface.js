/**
 * Render-only material weathering for procedural and hydrated natural-geology meshes.
 *
 * Source GLB maps remain authoritative. This layer only modulates their final PBR response in
 * deterministic world space so repeated instanced outcrops do not restart the same visible weathering
 * at every placement. It never changes geometry, terrain height, placement or collider authority.
 * @module world/naturalGeologyAssetSurface
 */

export const NATURAL_GEOLOGY_ASSET_SURFACE_POLICY = Object.freeze({
  id: 'natural-geology-asset-surface-2026-09-01-v1',
  renderOnly: true,
  deterministic: true,
  preservesAuthoredMaps: true,
  worldSpaceAlbedo: true,
  worldSpaceRoughness: true,
  worldSpaceNormal: true,
  multiScaleWeathering: true,
  geographyAuthorityUnchanged: true,
});

function familyProfile(family) {
  if (family === 'desert-rocks') {
    return Object.freeze({
      warm: [1.055, 0.985, 0.900],
      damp: [0.760, 0.735, 0.700],
      albedoGain: 0.18,
      dampStrength: 0.12,
      oxidationStrength: 0.15,
      roughnessBase: 0.91,
      roughnessRange: 0.10,
      normalStrength: 0.075,
    });
  }
  return Object.freeze({
    warm: [1.035, 1.010, 0.970],
    damp: [0.690, 0.735, 0.750],
    albedoGain: 0.16,
    dampStrength: 0.17,
    oxidationStrength: 0.075,
    roughnessBase: 0.89,
    roughnessRange: 0.12,
    normalStrength: 0.082,
  });
}

export function applyNaturalGeologyAssetSurface(material, { family = 'rocky-terrain' } = {}) {
  if (!material?.isMeshStandardMaterial) return material;
  const profile = familyProfile(family);
  material.metalness = 0;
  if (Number.isFinite(material.roughness)) material.roughness = Math.max(0.74, Math.min(0.98, material.roughness));
  material.userData = {
    ...material.userData,
    naturalGeologyAssetSurface: Object.freeze({
      policyId: NATURAL_GEOLOGY_ASSET_SURFACE_POLICY.id,
      family,
      preservesAuthoredMaps: true,
      worldSpace: true,
    }),
  };

  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey?.bind(material);
  material.onBeforeCompile = function compileNaturalGeologySurface(shader, renderer) {
    previousCompile?.call(this, shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vNaturalGeologyWorldPosition;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 naturalGeologyWorldPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
naturalGeologyWorldPosition = instanceMatrix * naturalGeologyWorldPosition;
#endif
vNaturalGeologyWorldPosition = (modelMatrix * naturalGeologyWorldPosition).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vNaturalGeologyWorldPosition;
float naturalGeologyHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float naturalGeologyNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = naturalGeologyHash(i);
  float b = naturalGeologyHash(i + vec2(1.0, 0.0));
  float c = naturalGeologyHash(i + vec2(0.0, 1.0));
  float d = naturalGeologyHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float naturalGeologyFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int octave = 0; octave < 4; octave++) {
    value += naturalGeologyNoise(p) * amplitude;
    p = mat2(0.80, -0.60, 0.60, 0.80) * p * 2.03 + vec2(11.7, -7.9);
    amplitude *= 0.48;
  }
  return value / 1.06136;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec2 naturalGeologyXZ = vNaturalGeologyWorldPosition.xz;
float naturalGeologyMacro = naturalGeologyFbm(naturalGeologyXZ / 520.0 + vec2(7.1, -13.4));
float naturalGeologyMeso = naturalGeologyFbm(naturalGeologyXZ / 118.0 + vec2(-17.2, 8.6));
float naturalGeologyFine = naturalGeologyNoise(naturalGeologyXZ / 31.0 + vec2(22.4, 5.7));
float naturalGeologySeam = 1.0 - abs(naturalGeologyFbm(vec2(naturalGeologyXZ.x / 176.0 + naturalGeologyXZ.y / 740.0, naturalGeologyXZ.y / 58.0 - naturalGeologyXZ.x / 910.0)) * 2.0 - 1.0);
float naturalGeologyDamp = smoothstep(0.60, 0.88, (1.0 - naturalGeologyMacro) * 0.52 + naturalGeologySeam * 0.48);
float naturalGeologyOxidation = smoothstep(0.64, 0.86, naturalGeologyMeso * 0.66 + naturalGeologyFine * 0.34);
vec3 naturalGeologyWarm = vec3(${profile.warm.map((v) => v.toFixed(3)).join(', ')});
vec3 naturalGeologyDampTone = vec3(${profile.damp.map((v) => v.toFixed(3)).join(', ')});
diffuseColor.rgb *= 1.0 + (naturalGeologyMacro - 0.5) * ${profile.albedoGain.toFixed(3)} + (naturalGeologyMeso - 0.5) * 0.095 + (naturalGeologyFine - 0.5) * 0.035;
diffuseColor.rgb *= mix(vec3(1.0), naturalGeologyDampTone, naturalGeologyDamp * ${profile.dampStrength.toFixed(3)});
diffuseColor.rgb *= mix(vec3(1.0), naturalGeologyWarm, naturalGeologyOxidation * ${profile.oxidationStrength.toFixed(3)});`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float naturalGeologyRoughTarget = ${profile.roughnessBase.toFixed(3)}
  + (naturalGeologyMeso - 0.5) * ${profile.roughnessRange.toFixed(3)}
  + (naturalGeologyFine - 0.5) * 0.055
  - naturalGeologyDamp * 0.085
  + naturalGeologyOxidation * 0.035;
roughnessFactor = mix(roughnessFactor, clamp(naturalGeologyRoughTarget, 0.58, 0.99), 0.58);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec2 naturalGeologyNormalP = naturalGeologyXZ / 17.0;
float naturalGeologyNx = naturalGeologyNoise(naturalGeologyNormalP + vec2(0.19, 0.0)) - naturalGeologyNoise(naturalGeologyNormalP - vec2(0.19, 0.0));
float naturalGeologyNz = naturalGeologyNoise(naturalGeologyNormalP + vec2(0.0, 0.19)) - naturalGeologyNoise(naturalGeologyNormalP - vec2(0.0, 0.19));
normal = normalize(normal + mat3(viewMatrix) * vec3(naturalGeologyNx, 0.0, naturalGeologyNz) * ${profile.normalStrength.toFixed(3)});`,
      );
  };
  material.customProgramCacheKey = () => `${previousCacheKey ? previousCacheKey() : ''}|${NATURAL_GEOLOGY_ASSET_SURFACE_POLICY.id}:${family}`;
  material.needsUpdate = true;
  return material;
}
