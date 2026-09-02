import * as THREE from 'three';
import { hashString } from './textureCore.js';

/**
 * Render-only, deterministic material weathering shared by generated world assets.
 *
 * The texture factory continues to own authored/generated maps and UV transforms. This adapter adds
 * world-space albedo, normal and roughness breakup after palette assignment so neighbouring meshes
 * do not restart the same visible pattern. It never changes geometry, placement, terrain, hydrology
 * or collision and adds no draw calls.
 */
export const WORLD_MATERIAL_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'world-material-surface-fabric-2026-09-02-v1',
  renderOnly: true,
  deterministic: true,
  worldSpace: true,
  sourceMapsPreserved: true,
  sourceUvTransformsPreserved: true,
  sourceShaderHooksPreserved: true,
  extraDrawCalls: 0,
  geometryUnchanged: true,
  placementUnchanged: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  macroScaleMeters: 94,
  mesoScaleMeters: 17,
  fineScaleMeters: 2.7,
  stainScaleMeters: 31,
  streakScaleMeters: 7.5,
  roughnessVariation: true,
  normalVariation: true,
  albedoVariation: true,
  profileIds: Object.freeze([
    'stone', 'wood', 'plaster', 'metal', 'cloth', 'vegetation', 'soil', 'snow', 'generic',
  ]),
});

const PROFILE_TABLE = Object.freeze({
  stone: Object.freeze({ albedoMacro: 0.12, albedoMeso: 0.085, albedoFine: 0.025, normalGain: 0.115, roughnessBase: 0.88, roughnessMacro: 0.14, roughnessFine: 0.07, dampGain: 0.18, stainGain: 0.13, streakGain: 0.09, verticalStreaks: true, oxidation: 0.035, moss: 0.07 }),
  wood: Object.freeze({ albedoMacro: 0.085, albedoMeso: 0.075, albedoFine: 0.035, normalGain: 0.085, roughnessBase: 0.79, roughnessMacro: 0.12, roughnessFine: 0.09, dampGain: 0.15, stainGain: 0.11, streakGain: 0.13, verticalStreaks: true, oxidation: 0.02, moss: 0.045 }),
  plaster: Object.freeze({ albedoMacro: 0.09, albedoMeso: 0.055, albedoFine: 0.018, normalGain: 0.045, roughnessBase: 0.84, roughnessMacro: 0.10, roughnessFine: 0.05, dampGain: 0.13, stainGain: 0.17, streakGain: 0.11, verticalStreaks: true, oxidation: 0.012, moss: 0.035 }),
  metal: Object.freeze({ albedoMacro: 0.07, albedoMeso: 0.055, albedoFine: 0.022, normalGain: 0.035, roughnessBase: 0.54, roughnessMacro: 0.19, roughnessFine: 0.12, dampGain: 0.08, stainGain: 0.11, streakGain: 0.16, verticalStreaks: true, oxidation: 0.17, moss: 0.005 }),
  cloth: Object.freeze({ albedoMacro: 0.065, albedoMeso: 0.045, albedoFine: 0.022, normalGain: 0.035, roughnessBase: 0.91, roughnessMacro: 0.075, roughnessFine: 0.055, dampGain: 0.09, stainGain: 0.07, streakGain: 0.035, verticalStreaks: false, oxidation: 0, moss: 0 }),
  vegetation: Object.freeze({ albedoMacro: 0.105, albedoMeso: 0.075, albedoFine: 0.028, normalGain: 0.06, roughnessBase: 0.83, roughnessMacro: 0.12, roughnessFine: 0.075, dampGain: 0.12, stainGain: 0.04, streakGain: 0.025, verticalStreaks: false, oxidation: 0, moss: 0.02 }),
  soil: Object.freeze({ albedoMacro: 0.13, albedoMeso: 0.095, albedoFine: 0.035, normalGain: 0.10, roughnessBase: 0.93, roughnessMacro: 0.10, roughnessFine: 0.08, dampGain: 0.19, stainGain: 0.08, streakGain: 0.04, verticalStreaks: false, oxidation: 0.015, moss: 0.025 }),
  snow: Object.freeze({ albedoMacro: 0.075, albedoMeso: 0.06, albedoFine: 0.032, normalGain: 0.055, roughnessBase: 0.82, roughnessMacro: 0.11, roughnessFine: 0.08, dampGain: 0.055, stainGain: 0.045, streakGain: 0.025, verticalStreaks: false, oxidation: 0, moss: 0 }),
  generic: Object.freeze({ albedoMacro: 0.075, albedoMeso: 0.055, albedoFine: 0.02, normalGain: 0.05, roughnessBase: 0.84, roughnessMacro: 0.10, roughnessFine: 0.06, dampGain: 0.10, stainGain: 0.07, streakGain: 0.045, verticalStreaks: false, oxidation: 0.015, moss: 0.015 }),
});

const PROFILE_PATTERNS = Object.freeze([
  ['snow', /snow|ice|winter|frost|glacier/],
  ['vegetation', /leaf|foliage|grass|moss|plant|tree|pine|shrub|hedge|vine/],
  ['wood', /wood|timber|oak|pinewood|bark|plank|beam|log|door/],
  ['metal', /metal|iron|steel|bronze|copper|brass|chain|blade|armor|armour/],
  ['plaster', /plaster|stucco|lime|wall|mortar|adobe/],
  ['cloth', /cloth|fabric|linen|wool|leather|banner|flag|cape|tent/],
  ['soil', /soil|earth|dirt|mud|sand|ground|path|road|farm|field/],
  ['stone', /stone|rock|granite|basalt|brick|masonry|castle|keep|tower|ruin/],
]);

function textSignature({ paletteId = '', subject = {}, mesh = null, material = null } = {}) {
  return [paletteId, subject?.id, subject?.name, subject?.category, subject?.src, mesh?.name, material?.name, material?.userData?.paletteId]
    .filter(Boolean).join('|').toLowerCase();
}

export function inferWorldMaterialSurfaceProfile(context = {}) {
  const signature = textSignature(context);
  for (const [profile, pattern] of PROFILE_PATTERNS) if (pattern.test(signature)) return profile;
  return 'generic';
}

function cloneMaterialPreservingMaps(material) {
  if (!material?.isMaterial) return material;
  const sourceOnBeforeCompile = material.onBeforeCompile;
  const sourceProgramKey = material.customProgramCacheKey;
  const clone = material.clone();
  // Three material clones share texture objects, preserving the source maps/UV transforms. Explicitly
  // carry custom shader hooks as well because layered/generated materials may already own a compile
  // adapter and Three's base Material.copy contract does not promise to copy user callbacks.
  clone.userData = { ...material.userData };
  if (typeof sourceOnBeforeCompile === 'function') clone.onBeforeCompile = sourceOnBeforeCompile;
  if (typeof sourceProgramKey === 'function') clone.customProgramCacheKey = sourceProgramKey;
  return clone;
}

function eachMaterial(mesh, callback) {
  if (!mesh?.material) return;
  if (Array.isArray(mesh.material)) mesh.material = mesh.material.map((material, materialIndex) => callback(material, materialIndex));
  else mesh.material = callback(mesh.material, 0);
}

function finite01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function glsl(value) {
  return Number(value).toFixed(5);
}

function installFabricShader(material, { profileId, seed, moisture = 0.42, exposure = 0.50, snow = 0, slope = 0 } = {}) {
  if (!material?.isMeshStandardMaterial && !material?.isMeshPhysicalMaterial) return material;
  const profile = PROFILE_TABLE[profileId] ?? PROFILE_TABLE.generic;
  const normalizedSeed = (seed >>> 0) % 104729;
  const moisture01 = finite01(moisture, 0.42);
  const exposure01 = finite01(exposure, 0.50);
  const snow01 = finite01(snow, 0);
  const slope01 = finite01(slope, 0);
  const previousCompile = material.onBeforeCompile?.bind(material);
  const previousKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldFabricPosition;\nvarying vec3 vWorldFabricNormal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWorldFabricNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvec4 worldFabricPosition = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nworldFabricPosition = instanceMatrix * worldFabricPosition;\n#endif\nvWorldFabricPosition = (modelMatrix * worldFabricPosition).xyz;');

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldFabricPosition;
varying vec3 vWorldFabricNormal;
float worldFabricHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33 + ${glsl((normalizedSeed % 997) / 997)});
  return fract((p.x + p.y) * p.z);
}
float worldFabricNoise(vec3 p) {
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  float n000 = worldFabricHash(i); float n100 = worldFabricHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = worldFabricHash(i + vec3(0.0, 1.0, 0.0)); float n110 = worldFabricHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = worldFabricHash(i + vec3(0.0, 0.0, 1.0)); float n101 = worldFabricHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = worldFabricHash(i + vec3(0.0, 1.0, 1.0)); float n111 = worldFabricHash(i + vec3(1.0, 1.0, 1.0));
  float nx00 = mix(n000, n100, f.x); float nx10 = mix(n010, n110, f.x);
  float nx01 = mix(n001, n101, f.x); float nx11 = mix(n011, n111, f.x);
  return mix(mix(nx00, nx10, f.y), mix(nx01, nx11, f.y), f.z);
}
float worldFabricFbm(vec3 p) {
  float total = 0.0; float amplitude = 0.56; float norm = 0.0;
  for (int octave = 0; octave < 4; octave++) {
    total += worldFabricNoise(p) * amplitude; norm += amplitude;
    p = mat3(0.80,0.00,-0.60, 0.18,0.95,0.24, 0.57,-0.31,0.76) * p * 2.03 + vec3(9.7,-4.2,13.1);
    amplitude *= 0.47;
  }
  return total / norm;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 worldFabricP = vWorldFabricPosition;
vec3 worldFabricN = normalize(vWorldFabricNormal);
float worldFabricMacro = worldFabricFbm(worldFabricP / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.macroScaleMeters)} + vec3(${glsl((normalizedSeed % 53) * 0.13)}, 0.0, ${glsl((normalizedSeed % 71) * -0.11)}));
float worldFabricMeso = worldFabricFbm(worldFabricP / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.mesoScaleMeters)} + vec3(-7.1, 3.8, 12.6));
float worldFabricFine = worldFabricNoise(worldFabricP / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.fineScaleMeters)} + vec3(17.4, -5.2, 8.9));
float worldFabricStain = worldFabricFbm(vec3(worldFabricP.x / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.stainScaleMeters)}, worldFabricP.y / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.stainScaleMeters * 0.58)}, worldFabricP.z / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.stainScaleMeters)}) + vec3(-11.4, 6.2, 19.7));
float worldFabricFacingUp = smoothstep(0.28, 0.88, worldFabricN.y);
float worldFabricFacingDown = smoothstep(0.18, 0.82, -worldFabricN.y);
float worldFabricVertical = 1.0 - smoothstep(0.15, 0.70, abs(worldFabricN.y));
float worldFabricMoist = clamp(${glsl(moisture01)} * 0.62 + (1.0 - worldFabricMacro) * 0.25 + worldFabricFacingDown * 0.13, 0.0, 1.0);
float worldFabricExposed = clamp(${glsl(exposure01)} * 0.68 + worldFabricFacingUp * 0.22 + (worldFabricMeso - 0.5) * 0.10, 0.0, 1.0);
float worldFabricSlopeContext = ${glsl(slope01)};
float worldFabricValue = (worldFabricMacro - 0.5) * ${glsl(profile.albedoMacro)} + (worldFabricMeso - 0.5) * ${glsl(profile.albedoMeso)} + (worldFabricFine - 0.5) * ${glsl(profile.albedoFine)};
diffuseColor.rgb *= 1.0 + worldFabricValue;
float worldFabricDamp = worldFabricMoist * smoothstep(0.48, 0.82, 1.0 - worldFabricStain);
diffuseColor.rgb *= 1.0 - worldFabricDamp * ${glsl(profile.dampGain)};
float worldFabricStainMask = smoothstep(0.61, 0.88, worldFabricStain) * (0.38 + worldFabricVertical * 0.62);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.315, 0.274, 0.213), worldFabricStainMask * ${glsl(profile.stainGain)});
float worldFabricVerticalCarrier = worldFabricNoise(vec3(worldFabricP.x / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.streakScaleMeters)}, worldFabricP.y / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.streakScaleMeters * 4.6)}, worldFabricP.z / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.streakScaleMeters)}) + vec3(4.9, -13.2, 7.7));
float worldFabricStreak = ${profile.verticalStreaks ? 'worldFabricVertical' : '0.0'} * smoothstep(0.63, 0.87, worldFabricVerticalCarrier) * worldFabricMoist;
diffuseColor.rgb *= 1.0 - worldFabricStreak * ${glsl(profile.streakGain)};
float worldFabricOxide = smoothstep(0.66, 0.90, worldFabricMeso * 0.62 + worldFabricStain * 0.38) * worldFabricExposed;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.410, 0.225, 0.122), worldFabricOxide * ${glsl(profile.oxidation)});
float worldFabricMoss = smoothstep(0.67, 0.90, 1.0 - worldFabricFine) * worldFabricMoist * (1.0 - worldFabricExposed * 0.55) * (0.55 + worldFabricFacingUp * 0.45);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.090, 0.142, 0.073), worldFabricMoss * ${glsl(profile.moss)});
float worldFabricSnow = ${glsl(snow01)} * worldFabricFacingUp * smoothstep(0.47, 0.78, worldFabricMacro + worldFabricMeso * 0.18);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.735, 0.785, 0.802), worldFabricSnow * 0.22);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.008), vec3(0.94));`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float worldFabricRough = ${glsl(profile.roughnessBase)} + (worldFabricMacro - 0.5) * ${glsl(profile.roughnessMacro)} + (worldFabricFine - 0.5) * ${glsl(profile.roughnessFine)} - worldFabricDamp * 0.08 - worldFabricStreak * 0.05 + worldFabricSnow * 0.06 + worldFabricSlopeContext * 0.015;
roughnessFactor = clamp(mix(roughnessFactor, worldFabricRough, 0.58), 0.32, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float worldFabricNormalStep = 0.18;
float worldFabricEast = worldFabricNoise((worldFabricP + vec3(worldFabricNormalStep, 0.0, 0.0)) / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.fineScaleMeters)});
float worldFabricWest = worldFabricNoise((worldFabricP - vec3(worldFabricNormalStep, 0.0, 0.0)) / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.fineScaleMeters)});
float worldFabricNorth = worldFabricNoise((worldFabricP + vec3(0.0, 0.0, worldFabricNormalStep)) / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.fineScaleMeters)});
float worldFabricSouth = worldFabricNoise((worldFabricP - vec3(0.0, 0.0, worldFabricNormalStep)) / ${glsl(WORLD_MATERIAL_SURFACE_FABRIC_POLICY.fineScaleMeters)});
vec3 worldFabricPerturb = vec3(worldFabricWest - worldFabricEast, 0.0, worldFabricSouth - worldFabricNorth);
normal = normalize(normal + mat3(viewMatrix) * worldFabricPerturb * ${glsl(profile.normalGain)} * (0.78 + worldFabricMeso * 0.44));`);
  };

  material.customProgramCacheKey = () => `${previousKey ? previousKey() : ''}|${WORLD_MATERIAL_SURFACE_FABRIC_POLICY.id}|${profileId}|${normalizedSeed}|m${moisture01.toFixed(3)}|e${exposure01.toFixed(3)}|s${snow01.toFixed(3)}|g${slope01.toFixed(3)}`;
  material.userData.worldMaterialSurfaceFabric = Object.freeze({
    policyId: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.id,
    profileId,
    seed: normalizedSeed,
    worldSpace: true,
    sourceMapsPreserved: true,
    sourceUvTransformsPreserved: true,
    sourceShaderHooksPreserved: true,
    albedoVariation: true,
    normalVariation: true,
    roughnessVariation: true,
    moisture: moisture01,
    exposure: exposure01,
    snow: snow01,
    slope: slope01,
  });
  material.needsUpdate = true;
  return material;
}

export function applyWorldMaterialSurfaceFabric(root, { paletteId = '', subject = {}, context = {}, variant = '' } = {}) {
  if (!root?.traverse) return Object.freeze({ appliedMaterialCount: 0, profileCounts: Object.freeze({}) });
  const objectSeed = hashString(`${variant || subject?.id || subject?.name || root.name || 'asset'}|${paletteId}|world-surface-fabric`);
  const profileCounts = {};
  let meshIndex = 0;
  let materialCount = 0;

  root.traverse((mesh) => {
    if (!mesh?.isMesh && !mesh?.isInstancedMesh) return;
    eachMaterial(mesh, (sourceMaterial, materialIndex) => {
      if (!sourceMaterial?.isMaterial) return sourceMaterial;
      const material = cloneMaterialPreservingMaps(sourceMaterial);
      const profileId = inferWorldMaterialSurfaceProfile({ paletteId, subject, mesh, material });
      const materialSeed = hashString(`${objectSeed}|${meshIndex}|${materialIndex}|${mesh.name || ''}|${material.name || ''}`);
      installFabricShader(material, { profileId, seed: materialSeed, moisture: context.moisture, exposure: context.exposure, snow: context.snow, slope: context.slope });
      profileCounts[profileId] = (profileCounts[profileId] ?? 0) + 1;
      materialCount += 1;
      return material;
    });
    meshIndex += 1;
  });

  root.userData ||= {};
  root.userData.worldMaterialSurfaceFabric = Object.freeze({
    policyId: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.id,
    appliedMaterialCount: materialCount,
    profileCounts: Object.freeze({ ...profileCounts }),
    worldSpace: true,
    deterministic: true,
    sourceShaderHooksPreserved: true,
    extraDrawCalls: 0,
  });
  return root.userData.worldMaterialSurfaceFabric;
}
