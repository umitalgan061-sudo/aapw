/**
 * Render-only geographic weathering for placed world assets.
 *
 * The shared material assignment core continues to own palette/texture selection. This layer clones
 * the already-assigned materials, preserves their authored maps and adds deterministic world-space
 * albedo/normal/roughness response driven by worldAssetGeographicProfile. It never changes geometry,
 * placement coordinates, terrain, hydrology or colliders.
 * @module world/worldAssetSurfaceWeathering
 */

import {
  WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY,
  inferWorldAssetMaterialFamily,
} from './worldAssetGeographicProfile.js';

const clamp01 = (value) => value < 0 ? 0 : value > 1 ? 1 : value;
const rounded = (value, digits = 5) => Number(Number(value || 0).toFixed(digits));

export const WORLD_ASSET_SURFACE_WEATHERING_POLICY = Object.freeze({
  id: 'world-asset-surface-weathering-2026-09-02-v1-geographic-multiscale-pbr',
  renderOnly: true,
  materialAssignmentAuthorityUnchanged: true,
  sourceTexturesPreserved: true,
  geometryUnchanged: true,
  placementUnchanged: true,
  canonicalGeographyUnchanged: true,
  geographicProfilePolicyId: WORLD_ASSET_GEOGRAPHIC_PROFILE_POLICY.id,
  macroMeters: 94,
  mesoMeters: 27,
  fineMeters: 5.6,
  microMeters: 1.45,
  dampPatchMeters: 41,
  frostPatchMeters: 19,
  saltPatchMeters: 12,
  abrasionMeters: 7.5,
  worldSpaceAlbedo: true,
  worldSpaceNormal: true,
  worldSpaceRoughness: true,
  maximumAlbedoDarkening: 0.23,
  maximumAlbedoLift: 0.12,
  maximumNormalGain: 0.075,
  roughnessFloor: 0.30,
  roughnessCeiling: 1,
});

const FAMILY_RESPONSE = Object.freeze({
  foliage: Object.freeze({ frost: 0.58, wet: 0.72, dry: 0.62, organic: 0.82, salt: 0.24, mineral: 0.10, abrasion: 0.18, normal: 0.34 }),
  wood: Object.freeze({ frost: 0.76, wet: 0.86, dry: 0.68, organic: 0.48, salt: 0.48, mineral: 0.20, abrasion: 0.52, normal: 0.70 }),
  stone: Object.freeze({ frost: 0.92, wet: 0.88, dry: 0.58, organic: 0.32, salt: 0.62, mineral: 0.78, abrasion: 0.76, normal: 0.92 }),
  metal: Object.freeze({ frost: 0.70, wet: 0.92, dry: 0.34, organic: 0.12, salt: 0.82, mineral: 0.42, abrasion: 0.88, normal: 0.42 }),
  soil: Object.freeze({ frost: 0.62, wet: 0.96, dry: 0.90, organic: 0.34, salt: 0.30, mineral: 0.46, abrasion: 0.30, normal: 0.58 }),
  fabric: Object.freeze({ frost: 0.48, wet: 0.72, dry: 0.46, organic: 0.18, salt: 0.22, mineral: 0.10, abrasion: 0.32, normal: 0.24 }),
  generic: Object.freeze({ frost: 0.68, wet: 0.72, dry: 0.56, organic: 0.20, salt: 0.36, mineral: 0.34, abrasion: 0.48, normal: 0.54 }),
});

function safeFamily(family) {
  return FAMILY_RESPONSE[family] ? family : 'generic';
}

function profileUniformRecord(profile, family) {
  const W = profile?.weathering || {};
  const response = FAMILY_RESPONSE[safeFamily(family)];
  return Object.freeze({
    frost: clamp01(W.frost) * response.frost,
    snowDust: clamp01(W.snowDust) * response.frost,
    wet: clamp01(W.wet) * response.wet,
    dry: clamp01(W.dry) * response.dry,
    organic: clamp01(W.organic) * response.organic,
    salt: clamp01(W.salt) * response.salt,
    mineral: clamp01(W.mineral) * response.mineral,
    abrasion: clamp01(W.abrasion) * response.abrasion,
    exposure: clamp01(W.exposure),
    shelter: clamp01(W.shelter),
    normalGain: WORLD_ASSET_SURFACE_WEATHERING_POLICY.maximumNormalGain * response.normal,
  });
}

function compactProfile(profile) {
  return Object.freeze({
    policyId: profile?.policyId || null,
    category: profile?.category || 'generic',
    suitability: rounded(profile?.suitability?.score),
    permanentIce: rounded(profile?.climate?.permanentIce),
    tundraBand: rounded(profile?.climate?.tundraBand),
    moisture: rounded(profile?.surface?.moisture),
    weathering: Object.freeze(Object.fromEntries(
      Object.entries(profile?.weathering || {}).map(([key, value]) => [key, rounded(value)]),
    )),
  });
}

function worldWeatheringAlreadyApplied(material) {
  return material?.userData?.worldAssetSurfaceWeathering?.policyId === WORLD_ASSET_SURFACE_WEATHERING_POLICY.id;
}

function collectWeatherableMaterialSlots(root) {
  const slots = [];
  root?.traverse?.((node) => {
    if (!node?.isMesh && !node?.isInstancedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    materials.forEach((material, index) => {
      if (!material?.isMeshStandardMaterial) return;
      slots.push({ node, material, index, array: Array.isArray(node.material) });
    });
  });
  return slots;
}

function shaderNoiseLibrary(P) {
  return /* glsl */ `
float worldAssetGeoHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float worldAssetGeoNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = worldAssetGeoHash(i);
  float b = worldAssetGeoHash(i + vec2(1.0, 0.0));
  float c = worldAssetGeoHash(i + vec2(0.0, 1.0));
  float d = worldAssetGeoHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float worldAssetGeoTriaxial(vec3 p) {
  float xy = worldAssetGeoNoise(p.xy);
  float xz = worldAssetGeoNoise(p.xz + vec2(17.31, -8.17));
  float yz = worldAssetGeoNoise(p.yz + vec2(-11.73, 23.41));
  return xy * 0.31 + xz * 0.43 + yz * 0.26;
}
float worldAssetGeoFbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.55;
  float weight = 0.0;
  for (int octave = 0; octave < 4; octave++) {
    value += worldAssetGeoTriaxial(p) * amplitude;
    weight += amplitude;
    p = p * 2.03 + vec3(13.7, -9.1, 6.4);
    amplitude *= 0.47;
  }
  return value / max(weight, 0.0001);
}
float worldAssetGeoRidge(float value) {
  return 1.0 - abs(value * 2.0 - 1.0);
}
const float WORLD_ASSET_GEO_MACRO_METERS = ${P.macroMeters.toFixed(2)};
const float WORLD_ASSET_GEO_MESO_METERS = ${P.mesoMeters.toFixed(2)};
const float WORLD_ASSET_GEO_FINE_METERS = ${P.fineMeters.toFixed(2)};
const float WORLD_ASSET_GEO_MICRO_METERS = ${P.microMeters.toFixed(2)};
`;
}

function installWorldAssetWeatheringShader(material, profile, family) {
  const P = WORLD_ASSET_SURFACE_WEATHERING_POLICY;
  const values = profileUniformRecord(profile, family);
  const previousCompile = material.onBeforeCompile;
  const previousCacheKey = material.customProgramCacheKey;
  const uniformState = {
    frost: { value: values.frost },
    snowDust: { value: values.snowDust },
    wet: { value: values.wet },
    dry: { value: values.dry },
    organic: { value: values.organic },
    salt: { value: values.salt },
    mineral: { value: values.mineral },
    abrasion: { value: values.abrasion },
    exposure: { value: values.exposure },
    shelter: { value: values.shelter },
    normalGain: { value: values.normalGain },
  };

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    Object.assign(shader.uniforms, {
      uWorldAssetGeoFrost: uniformState.frost,
      uWorldAssetGeoSnowDust: uniformState.snowDust,
      uWorldAssetGeoWet: uniformState.wet,
      uWorldAssetGeoDry: uniformState.dry,
      uWorldAssetGeoOrganic: uniformState.organic,
      uWorldAssetGeoSalt: uniformState.salt,
      uWorldAssetGeoMineral: uniformState.mineral,
      uWorldAssetGeoAbrasion: uniformState.abrasion,
      uWorldAssetGeoExposure: uniformState.exposure,
      uWorldAssetGeoShelter: uniformState.shelter,
      uWorldAssetGeoNormalGain: uniformState.normalGain,
    });

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldAssetGeoPosition;',
      )
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
vec4 worldAssetGeoPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  worldAssetGeoPosition = batchingMatrix * worldAssetGeoPosition;
#endif
#ifdef USE_INSTANCING
  worldAssetGeoPosition = instanceMatrix * worldAssetGeoPosition;
#endif
vWorldAssetGeoPosition = (modelMatrix * worldAssetGeoPosition).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldAssetGeoPosition;
uniform float uWorldAssetGeoFrost;
uniform float uWorldAssetGeoSnowDust;
uniform float uWorldAssetGeoWet;
uniform float uWorldAssetGeoDry;
uniform float uWorldAssetGeoOrganic;
uniform float uWorldAssetGeoSalt;
uniform float uWorldAssetGeoMineral;
uniform float uWorldAssetGeoAbrasion;
uniform float uWorldAssetGeoExposure;
uniform float uWorldAssetGeoShelter;
uniform float uWorldAssetGeoNormalGain;
${shaderNoiseLibrary(P)}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 worldAssetGeoP = vWorldAssetGeoPosition;
float worldAssetGeoWarpA = worldAssetGeoFbm(worldAssetGeoP / 177.0 + vec3(3.2, -8.4, 11.7));
float worldAssetGeoWarpB = worldAssetGeoFbm(worldAssetGeoP / 139.0 + vec3(-13.1, 5.6, 2.9));
vec3 worldAssetGeoWarped = worldAssetGeoP + (vec3(worldAssetGeoWarpA, worldAssetGeoWarpB, worldAssetGeoWarpA - worldAssetGeoWarpB) - 0.5) * 39.0;
float worldAssetGeoMacro = worldAssetGeoFbm(worldAssetGeoWarped / WORLD_ASSET_GEO_MACRO_METERS + vec3(7.1, -4.3, 12.8));
float worldAssetGeoMeso = worldAssetGeoFbm(worldAssetGeoWarped / WORLD_ASSET_GEO_MESO_METERS + vec3(-17.4, 9.2, 3.5));
float worldAssetGeoFine = worldAssetGeoTriaxial(worldAssetGeoP / WORLD_ASSET_GEO_FINE_METERS + vec3(21.1, 2.7, -14.6));
float worldAssetGeoMicro = worldAssetGeoTriaxial(worldAssetGeoP / WORLD_ASSET_GEO_MICRO_METERS + vec3(-5.9, 31.2, 8.6));
float worldAssetGeoWeather = clamp(worldAssetGeoMacro * 0.48 + worldAssetGeoMeso * 0.33 + worldAssetGeoFine * 0.19, 0.0, 1.0);
float worldAssetGeoDampPatch = smoothstep(0.48, 0.82, worldAssetGeoFbm(worldAssetGeoWarped / ${P.dampPatchMeters.toFixed(2)} + vec3(6.4, -19.3, 12.1)));
float worldAssetGeoFrostPatch = smoothstep(0.43, 0.80, worldAssetGeoFbm(worldAssetGeoWarped / ${P.frostPatchMeters.toFixed(2)} + vec3(-11.7, 4.6, 29.1)));
float worldAssetGeoSaltPatch = smoothstep(0.57, 0.88, worldAssetGeoRidge(worldAssetGeoFbm(worldAssetGeoWarped / ${P.saltPatchMeters.toFixed(2)} + vec3(17.2, 8.1, -6.3))));
float worldAssetGeoAbrasionPatch = smoothstep(0.45, 0.84, worldAssetGeoRidge(worldAssetGeoFbm(worldAssetGeoWarped / ${P.abrasionMeters.toFixed(2)} + vec3(-8.8, 15.4, 22.7))));

float worldAssetGeoWetMask = uWorldAssetGeoWet * worldAssetGeoDampPatch;
float worldAssetGeoFrostMask = uWorldAssetGeoFrost * worldAssetGeoFrostPatch;
float worldAssetGeoSnowMask = uWorldAssetGeoSnowDust * smoothstep(0.56, 0.86, worldAssetGeoMacro * 0.62 + worldAssetGeoMeso * 0.38);
float worldAssetGeoDryMask = uWorldAssetGeoDry * smoothstep(0.44, 0.80, 1.0 - worldAssetGeoDampPatch) * (0.64 + worldAssetGeoWeather * 0.36);
float worldAssetGeoOrganicMask = uWorldAssetGeoOrganic * smoothstep(0.48, 0.82, 1.0 - worldAssetGeoFine) * (0.68 + worldAssetGeoDampPatch * 0.32);
float worldAssetGeoSaltMask = uWorldAssetGeoSalt * worldAssetGeoSaltPatch;
float worldAssetGeoMineralMask = uWorldAssetGeoMineral * smoothstep(0.54, 0.84, worldAssetGeoMeso);
float worldAssetGeoAbrasionMask = uWorldAssetGeoAbrasion * worldAssetGeoAbrasionPatch;

vec3 worldAssetGeoBase = diffuseColor.rgb;
float worldAssetGeoLuma = dot(worldAssetGeoBase, vec3(0.2126, 0.7152, 0.0722));
vec3 worldAssetGeoFrostTone = mix(vec3(worldAssetGeoLuma), vec3(0.64, 0.70, 0.73), 0.46);
vec3 worldAssetGeoSnowTone = vec3(0.76, 0.79, 0.79);
vec3 worldAssetGeoWetTone = worldAssetGeoBase * vec3(0.67, 0.72, 0.70);
vec3 worldAssetGeoDryTone = mix(worldAssetGeoBase, vec3(worldAssetGeoLuma * 1.02, worldAssetGeoLuma * 0.94, worldAssetGeoLuma * 0.80), 0.38);
vec3 worldAssetGeoOrganicTone = mix(worldAssetGeoBase, vec3(0.13, 0.19, 0.10), 0.42);
vec3 worldAssetGeoSaltTone = mix(worldAssetGeoBase, vec3(0.62, 0.61, 0.55), 0.34);
vec3 worldAssetGeoMineralTone = mix(worldAssetGeoBase, vec3(0.42, 0.39, 0.34), 0.22);

diffuseColor.rgb = mix(diffuseColor.rgb, worldAssetGeoWetTone, worldAssetGeoWetMask * 0.24);
diffuseColor.rgb = mix(diffuseColor.rgb, worldAssetGeoDryTone, worldAssetGeoDryMask * 0.19);
diffuseColor.rgb = mix(diffuseColor.rgb, worldAssetGeoOrganicTone, worldAssetGeoOrganicMask * 0.20);
diffuseColor.rgb = mix(diffuseColor.rgb, worldAssetGeoMineralTone, worldAssetGeoMineralMask * 0.16);
diffuseColor.rgb = mix(diffuseColor.rgb, worldAssetGeoFrostTone, worldAssetGeoFrostMask * 0.28);
diffuseColor.rgb = mix(diffuseColor.rgb, worldAssetGeoSnowTone, worldAssetGeoSnowMask * 0.13);
diffuseColor.rgb = mix(diffuseColor.rgb, worldAssetGeoSaltTone, worldAssetGeoSaltMask * 0.16);
diffuseColor.rgb *= 0.95 + worldAssetGeoWeather * 0.10 + (worldAssetGeoFine - 0.5) * 0.035;
diffuseColor.rgb *= 1.0 - worldAssetGeoAbrasionMask * (0.018 + worldAssetGeoMicro * 0.025);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.012), vec3(0.94));`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
float worldAssetGeoNormalStep = 0.21;
vec3 worldAssetGeoNormalP = worldAssetGeoP / WORLD_ASSET_GEO_MICRO_METERS;
float worldAssetGeoNx = worldAssetGeoTriaxial(worldAssetGeoNormalP + vec3(worldAssetGeoNormalStep, 0.0, 0.0))
  - worldAssetGeoTriaxial(worldAssetGeoNormalP - vec3(worldAssetGeoNormalStep, 0.0, 0.0));
float worldAssetGeoNy = worldAssetGeoTriaxial(worldAssetGeoNormalP + vec3(0.0, worldAssetGeoNormalStep, 0.0))
  - worldAssetGeoTriaxial(worldAssetGeoNormalP - vec3(0.0, worldAssetGeoNormalStep, 0.0));
float worldAssetGeoNz = worldAssetGeoTriaxial(worldAssetGeoNormalP + vec3(0.0, 0.0, worldAssetGeoNormalStep))
  - worldAssetGeoTriaxial(worldAssetGeoNormalP - vec3(0.0, 0.0, worldAssetGeoNormalStep));
float worldAssetGeoNormalMask = clamp(
  0.26
    + worldAssetGeoFrostMask * 0.34
    + worldAssetGeoDryMask * 0.18
    + worldAssetGeoMineralMask * 0.24
    + worldAssetGeoAbrasionMask * 0.24
    - worldAssetGeoWetMask * 0.12,
  0.0, 1.0
);
normal = normalize(normal + mat3(viewMatrix) * vec3(worldAssetGeoNx, worldAssetGeoNy, worldAssetGeoNz)
  * uWorldAssetGeoNormalGain * worldAssetGeoNormalMask);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float worldAssetGeoRoughBreakup = (worldAssetGeoMeso - 0.5) * 0.10 + (worldAssetGeoFine - 0.5) * 0.065;
float worldAssetGeoWetPolish = worldAssetGeoWetMask * (0.085 + worldAssetGeoDampPatch * 0.075);
float worldAssetGeoFrostPolish = worldAssetGeoFrostMask * (0.028 + worldAssetGeoFine * 0.035);
float worldAssetGeoDryRoughness = worldAssetGeoDryMask * 0.075;
float worldAssetGeoOrganicRoughness = worldAssetGeoOrganicMask * 0.040;
float worldAssetGeoSaltRoughness = worldAssetGeoSaltMask * 0.055;
float worldAssetGeoAbrasionPolish = worldAssetGeoAbrasionMask * 0.045;
roughnessFactor = clamp(
  roughnessFactor + worldAssetGeoRoughBreakup - worldAssetGeoWetPolish - worldAssetGeoFrostPolish
    + worldAssetGeoDryRoughness + worldAssetGeoOrganicRoughness + worldAssetGeoSaltRoughness
    - worldAssetGeoAbrasionPolish,
  ${P.roughnessFloor.toFixed(2)}, ${P.roughnessCeiling.toFixed(2)}
);`,
      );
  };

  material.customProgramCacheKey = () => `${previousCacheKey?.() || ''}:${P.id}:${safeFamily(family)}`;
  material.userData ||= {};
  material.userData.worldAssetSurfaceWeathering = Object.freeze({
    policyId: P.id,
    profilePolicyId: profile?.policyId || null,
    family: safeFamily(family),
    sourceMapsPreserved: true,
    worldSpace: true,
    albedoVariation: true,
    normalVariation: true,
    roughnessVariation: true,
    weights: values,
  });
  material.userData.worldAssetSurfaceWeatheringUniforms = uniformState;
  material.needsUpdate = true;
  return material;
}

function cloneWeatheredMaterial(material, profile, family) {
  if (!material?.isMeshStandardMaterial) return material;
  if (worldWeatheringAlreadyApplied(material)) return material;
  const clone = material.clone();
  clone.userData = { ...(material.userData || {}) };
  return installWorldAssetWeatheringShader(clone, profile, family);
}

export function applyWorldAssetGeographicWeathering(object, profile, {
  metadata = {},
} = {}) {
  if (!object || !profile) return Object.freeze({ ok: false, error: 'missing-object-or-profile', materialCount: 0 });
  const slots = collectWeatherableMaterialSlots(object);
  if (!slots.length) {
    object.userData ||= {};
    object.userData.worldAssetGeographicProfile = compactProfile(profile);
    object.userData.worldAssetSurfaceWeathering = Object.freeze({
      policyId: WORLD_ASSET_SURFACE_WEATHERING_POLICY.id,
      materialCount: 0,
      status: 'no-mesh-standard-material',
    });
    return Object.freeze({ ok: true, materialCount: 0, skipped: slots.length });
  }

  const perNode = new Map();
  let materialCount = 0;
  const families = new Set();
  for (const slot of slots) {
    if (!perNode.has(slot.node)) {
      perNode.set(slot.node, Array.isArray(slot.node.material) ? [...slot.node.material] : [slot.node.material]);
    }
    const family = inferWorldAssetMaterialFamily({
      category: profile.category,
      materialName: slot.material?.name || '',
      meshName: slot.node?.name || '',
      assetName: metadata.name || object.name || '',
    });
    families.add(family);
    const next = cloneWeatheredMaterial(slot.material, profile, family);
    perNode.get(slot.node)[slot.index] = next;
    if (next !== slot.material) materialCount += 1;
  }

  for (const [node, materials] of perNode) {
    node.material = Array.isArray(node.material) ? materials : materials[0];
  }
  object.userData ||= {};
  object.userData.worldAssetGeographicProfile = compactProfile(profile);
  object.userData.worldAssetSurfaceWeathering = Object.freeze({
    policyId: WORLD_ASSET_SURFACE_WEATHERING_POLICY.id,
    profilePolicyId: profile.policyId,
    materialCount,
    families: Object.freeze([...families].sort()),
    sourceTexturesPreserved: true,
    geometryUnchanged: true,
    placementUnchanged: true,
  });
  object.updateMatrixWorld?.(true);
  return Object.freeze({
    ok: true,
    materialCount,
    families: Object.freeze([...families].sort()),
    profile: object.userData.worldAssetGeographicProfile,
  });
}

export function auditWorldAssetGeographicWeathering(object) {
  const errors = [];
  const warnings = [];
  const rootState = object?.userData?.worldAssetSurfaceWeathering;
  const profile = object?.userData?.worldAssetGeographicProfile;
  if (!profile) errors.push('missing-geographic-profile');
  if (!rootState) errors.push('missing-geographic-weathering');
  let weathered = 0;
  let standard = 0;
  object?.traverse?.((node) => {
    if (!node?.isMesh && !node?.isInstancedMesh) return;
    const materials = Array.isArray(node.material) ? node.material : node.material ? [node.material] : [];
    for (const material of materials) {
      if (!material?.isMeshStandardMaterial) continue;
      standard += 1;
      const state = material.userData?.worldAssetSurfaceWeathering;
      if (!state) {
        warnings.push(`unweathered-standard-material:${node.name || 'mesh'}`);
        continue;
      }
      weathered += 1;
      if (state.policyId !== WORLD_ASSET_SURFACE_WEATHERING_POLICY.id) errors.push('weathering-policy-mismatch');
      if (!state.sourceMapsPreserved) errors.push('source-map-contract-lost');
      const key = material.customProgramCacheKey?.() || '';
      if (!key.includes(WORLD_ASSET_SURFACE_WEATHERING_POLICY.id)) errors.push('shader-cache-key-missing');
    }
  });
  if (standard > 0 && weathered === 0) errors.push('no-weathered-standard-material');
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze([...new Set(errors)]),
    warnings: Object.freeze([...new Set(warnings)]),
    standardMaterialCount: standard,
    weatheredMaterialCount: weathered,
    profile: profile || null,
    state: rootState || null,
  });
}
