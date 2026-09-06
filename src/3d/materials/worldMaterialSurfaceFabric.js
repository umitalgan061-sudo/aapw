import * as THREE from 'three';
import { hashString } from './textureCore.js';

/**
 * Render-only deterministic surface fabric for generated/authored world assets.
 *
 * Authored maps and UV transforms remain untouched. The shader adds world-space variation whose
 * scales and physical response can be specialized by the placement-time asset surface profile.
 */
export const WORLD_MATERIAL_SURFACE_FABRIC_POLICY = Object.freeze({
  // Compatibility id is intentionally stable for exact-head contract guards.
  id: 'world-material-surface-fabric-2026-09-02-v1',
  revision: 'v5-family-scales-anisotropy-independent-domains',
  renderOnly: true,
  deterministic: true,
  worldSpace: true,
  sourceMapsPreserved: true,
  sourceUvTransformsPreserved: true,
  sourceShaderHooksPreserved: true,
  placementContextAtCompileTime: true,
  assetProfileContextAtCompileTime: true,
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
  familySpecificScales: true,
  independentRoughnessDomain: true,
  independentNormalDomain: true,
  anisotropicStrataAndGrain: true,
  profileIds: Object.freeze([
    'stone', 'wood', 'plaster', 'metal', 'cloth', 'vegetation', 'soil', 'snow', 'generic',
  ]),
});

const PROFILE_TABLE = Object.freeze({
  stone: Object.freeze({
    albedoMacro: 0.12, albedoMeso: 0.085, albedoFine: 0.025,
    normalGain: 0.115, roughnessBase: 0.88, roughnessMacro: 0.14, roughnessFine: 0.07,
    dampGain: 0.18, stainGain: 0.13, streakGain: 0.09,
    oxidation: 0.035, moss: 0.07, macroScale: 94, mesoScale: 17, fineScale: 2.7,
  }),
  wood: Object.freeze({
    albedoMacro: 0.085, albedoMeso: 0.075, albedoFine: 0.035,
    normalGain: 0.085, roughnessBase: 0.79, roughnessMacro: 0.12, roughnessFine: 0.09,
    dampGain: 0.15, stainGain: 0.11, streakGain: 0.13,
    oxidation: 0.02, moss: 0.045, macroScale: 46, mesoScale: 10, fineScale: 0.9,
  }),
  plaster: Object.freeze({
    albedoMacro: 0.09, albedoMeso: 0.055, albedoFine: 0.018,
    normalGain: 0.045, roughnessBase: 0.84, roughnessMacro: 0.10, roughnessFine: 0.05,
    dampGain: 0.13, stainGain: 0.17, streakGain: 0.11,
    oxidation: 0.012, moss: 0.035, macroScale: 84, mesoScale: 17, fineScale: 2.1,
  }),
  metal: Object.freeze({
    albedoMacro: 0.07, albedoMeso: 0.055, albedoFine: 0.022,
    normalGain: 0.035, roughnessBase: 0.54, roughnessMacro: 0.19, roughnessFine: 0.12,
    dampGain: 0.08, stainGain: 0.11, streakGain: 0.16,
    oxidation: 0.17, moss: 0.005, macroScale: 40, mesoScale: 8, fineScale: 0.8,
  }),
  cloth: Object.freeze({
    albedoMacro: 0.065, albedoMeso: 0.045, albedoFine: 0.022,
    normalGain: 0.035, roughnessBase: 0.91, roughnessMacro: 0.075, roughnessFine: 0.055,
    dampGain: 0.09, stainGain: 0.07, streakGain: 0.035,
    oxidation: 0, moss: 0, macroScale: 38, mesoScale: 8, fineScale: 0.65,
  }),
  vegetation: Object.freeze({
    albedoMacro: 0.105, albedoMeso: 0.075, albedoFine: 0.028,
    normalGain: 0.06, roughnessBase: 0.83, roughnessMacro: 0.12, roughnessFine: 0.075,
    dampGain: 0.12, stainGain: 0.04, streakGain: 0.025,
    oxidation: 0, moss: 0.02, macroScale: 34, mesoScale: 8.5, fineScale: 1.1,
  }),
  soil: Object.freeze({
    albedoMacro: 0.13, albedoMeso: 0.095, albedoFine: 0.035,
    normalGain: 0.10, roughnessBase: 0.93, roughnessMacro: 0.10, roughnessFine: 0.08,
    dampGain: 0.19, stainGain: 0.08, streakGain: 0.04,
    oxidation: 0.015, moss: 0.025, macroScale: 76, mesoScale: 16, fineScale: 2.3,
  }),
  snow: Object.freeze({
    albedoMacro: 0.075, albedoMeso: 0.06, albedoFine: 0.032,
    normalGain: 0.055, roughnessBase: 0.82, roughnessMacro: 0.11, roughnessFine: 0.08,
    dampGain: 0.055, stainGain: 0.045, streakGain: 0.025,
    oxidation: 0, moss: 0, macroScale: 96, mesoScale: 19, fineScale: 2.2,
  }),
  generic: Object.freeze({
    albedoMacro: 0.075, albedoMeso: 0.055, albedoFine: 0.02,
    normalGain: 0.05, roughnessBase: 0.84, roughnessMacro: 0.10, roughnessFine: 0.06,
    dampGain: 0.10, stainGain: 0.07, streakGain: 0.045,
    oxidation: 0.015, moss: 0.015, macroScale: 79, mesoScale: 16, fineScale: 2.2,
  }),
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
  return [
    paletteId,
    subject?.id,
    subject?.name,
    subject?.category,
    subject?.src,
    mesh?.name,
    material?.name,
    material?.userData?.paletteId,
  ].filter(Boolean).join('|').toLowerCase();
}

export function inferWorldMaterialSurfaceProfile(context = {}) {
  const signature = textSignature(context);
  for (const [profile, pattern] of PROFILE_PATTERNS) {
    if (pattern.test(signature)) return profile;
  }
  return 'generic';
}

function cloneMaterialPreservingMaps(material) {
  if (!material?.isMaterial) return material;
  const sourceOnBeforeCompile = material.onBeforeCompile;
  const sourceProgramKey = material.customProgramCacheKey;
  const clone = material.clone();
  clone.userData = { ...material.userData };
  if (typeof sourceOnBeforeCompile === 'function') clone.onBeforeCompile = sourceOnBeforeCompile;
  if (typeof sourceProgramKey === 'function') clone.customProgramCacheKey = sourceProgramKey;
  return clone;
}

function eachMaterial(mesh, callback) {
  if (!mesh?.material) return;
  if (Array.isArray(mesh.material)) {
    mesh.material = mesh.material.map((material, materialIndex) => callback(material, materialIndex));
  } else {
    mesh.material = callback(mesh.material, 0);
  }
}

function finite01(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number));
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function glsl(value) {
  return Number(value).toFixed(5);
}

function compileContext(material, fallback, legacyProfile) {
  const placement = material?.userData?.worldPlacementMaterialContext ?? {};
  const asset = material?.userData?.worldAssetSurfaceResponse ?? {};
  const scales = asset.scales ?? placement.surfaceScales ?? {};
  const fabric = asset.fabric ?? placement.fabric ?? {};
  const environment = asset.environment ?? {};
  return Object.freeze({
    moisture: finite01(placement.moisture, fallback.moisture),
    exposure: finite01(placement.exposure, fallback.exposure),
    snow: finite01(placement.snow, fallback.snow),
    slope: finite01(placement.slope, fallback.slope),
    shelter: finite01(placement.shelter, 0.5),
    aridity: finite01(placement.aridity, 0.4),
    erosion: finite01(placement.erosion, 0.4),
    lithic: finite01(placement.lithic, 0.3),
    frost: finite01(placement.frost, 0),
    weathering: finite01(placement.weathering, 0.45),
    moss: finite01(environment.moss ?? placement.moss, 0),
    lichen: finite01(environment.lichen ?? placement.lichen, 0),
    oxidation: finite01(environment.oxidation, 0),
    salt: finite01(environment.salt, 0),
    macroScale: finitePositive(scales.macroMeters, legacyProfile.macroScale),
    mesoScale: finitePositive(scales.mesoMeters, legacyProfile.mesoScale),
    fineScale: finitePositive(scales.fineMeters, legacyProfile.fineScale),
    normalStrength: finite01(asset.normalStrength, legacyProfile.normalGain),
    strataStrength: finite01(fabric.strataStrength, 0),
    strataFrequency: finitePositive(fabric.strataFrequency, 0.11),
    grainStrength: finite01(fabric.grainStrength, 0),
    grainFrequency: finitePositive(fabric.grainFrequency, 0.28),
    sedimentStrength: finite01(fabric.sedimentStrength, 0),
    sedimentFrequency: finitePositive(fabric.sedimentFrequency, 0.12),
    canopyMottle: finite01(fabric.canopyMottle, 0),
    chlorophyllVariation: finite01(fabric.chlorophyllVariation, 0),
    streakStrength: finite01(fabric.streakStrength ?? fabric.dripStrength, legacyProfile.streakGain),
    crustStrength: finite01(fabric.crustStrength, 0),
    windSastrugi: finite01(fabric.windSastrugi, 0),
  });
}

function installFabricShader(material, {
  profileId,
  seed,
  moisture = 0.42,
  exposure = 0.50,
  snow = 0,
  slope = 0,
} = {}) {
  if (!material?.isMeshStandardMaterial && !material?.isMeshPhysicalMaterial) return material;
  const profile = PROFILE_TABLE[profileId] ?? PROFILE_TABLE.generic;
  const normalizedSeed = (seed >>> 0) % 104729;
  const fallback = Object.freeze({
    moisture: finite01(moisture, 0.42),
    exposure: finite01(exposure, 0.50),
    snow: finite01(snow, 0),
    slope: finite01(slope, 0),
  });
  const previousCompile = material.onBeforeCompile?.bind(material);
  const previousKey = material.customProgramCacheKey?.bind(material);

  material.onBeforeCompile = (shader, renderer) => {
    previousCompile?.(shader, renderer);
    const context = compileContext(material, fallback, profile);
    const seedA = (normalizedSeed % 997) / 997;
    const seedB = (normalizedSeed % 991) / 991;
    const seedC = (normalizedSeed % 983) / 983;

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldFabricPosition;\nvarying vec3 vWorldFabricNormal;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvWorldFabricNormal = normalize(mat3(modelMatrix) * objectNormal);',
      )
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvec4 worldFabricPosition = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\nworldFabricPosition = instanceMatrix * worldFabricPosition;\n#endif\nvWorldFabricPosition = (modelMatrix * worldFabricPosition).xyz;',
      );

    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
varying vec3 vWorldFabricPosition;
varying vec3 vWorldFabricNormal;
float worldFabricHash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yzx + 33.33 + ${glsl(seedA)});
  return fract((p.x + p.y) * p.z);
}
float worldFabricNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float n000 = worldFabricHash(i);
  float n100 = worldFabricHash(i + vec3(1.0, 0.0, 0.0));
  float n010 = worldFabricHash(i + vec3(0.0, 1.0, 0.0));
  float n110 = worldFabricHash(i + vec3(1.0, 1.0, 0.0));
  float n001 = worldFabricHash(i + vec3(0.0, 0.0, 1.0));
  float n101 = worldFabricHash(i + vec3(1.0, 0.0, 1.0));
  float n011 = worldFabricHash(i + vec3(0.0, 1.0, 1.0));
  float n111 = worldFabricHash(i + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),
    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),
    f.z
  );
}
float worldFabricFbm(vec3 p) {
  float total = 0.0;
  float amplitude = 0.56;
  float norm = 0.0;
  for (int octave = 0; octave < 4; octave++) {
    total += worldFabricNoise(p) * amplitude;
    norm += amplitude;
    p = mat3(0.80,0.00,-0.60, 0.18,0.95,0.24, 0.57,-0.31,0.76) * p * 2.03
      + vec3(9.7,-4.2,13.1);
    amplitude *= 0.47;
  }
  return total / max(0.0001, norm);
}
float worldFabricRidged(vec3 p) {
  float n = worldFabricFbm(p);
  float ridge = 1.0 - abs(n * 2.0 - 1.0);
  return ridge * ridge;
}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
vec3 worldFabricP = vWorldFabricPosition;
vec3 worldFabricN = normalize(vWorldFabricNormal);
float worldFabricMacro = worldFabricFbm(
  worldFabricP / ${glsl(context.macroScale)}
  + vec3(${glsl(seedA * 19.0)}, ${glsl(seedB * 7.0)}, ${glsl(-seedC * 17.0)})
);
float worldFabricMeso = worldFabricFbm(
  worldFabricP / ${glsl(context.mesoScale)}
  + vec3(${glsl(-seedB * 23.0)}, ${glsl(seedC * 11.0)}, ${glsl(seedA * 29.0)})
);
float worldFabricFine = worldFabricNoise(
  worldFabricP / ${glsl(context.fineScale)}
  + vec3(${glsl(seedC * 31.0)}, ${glsl(-seedA * 13.0)}, ${glsl(seedB * 37.0)})
);
float worldFabricRoughDomain = worldFabricFbm(
  worldFabricP / ${glsl(context.mesoScale * 0.73)}
  + vec3(41.3, -17.9, 23.7)
);
float worldFabricNormalDomain = worldFabricRidged(
  worldFabricP / ${glsl(context.fineScale * 1.31)}
  + vec3(-29.1, 31.7, 11.3)
);
float worldFabricFacingUp = smoothstep(0.28, 0.88, worldFabricN.y);
float worldFabricVertical = 1.0 - smoothstep(0.15, 0.72, abs(worldFabricN.y));
float worldFabricMoist = clamp(
  ${glsl(context.moisture)} * 0.58
  + (1.0 - worldFabricMacro) * 0.19
  + ${glsl(context.shelter)} * 0.12
  + (1.0 - worldFabricFacingUp) * 0.08,
  0.0, 1.0
);
float worldFabricExposure = clamp(
  ${glsl(context.exposure)} * 0.64
  + worldFabricFacingUp * 0.16
  + (worldFabricMeso - 0.5) * 0.12
  + ${glsl(context.erosion)} * 0.10,
  0.0, 1.0
);
float worldFabricAnisotropic = 0.0;
worldFabricAnisotropic += sin(
  worldFabricP.y * ${glsl(context.strataFrequency)}
  + worldFabricP.x * ${glsl(context.strataFrequency * 0.37)}
  + worldFabricMeso * 4.2
) * ${glsl(context.strataStrength)};
worldFabricAnisotropic += sin(
  worldFabricP.y * ${glsl(context.grainFrequency)}
  + worldFabricP.z * ${glsl(context.grainFrequency * 0.23)}
  + worldFabricFine * 3.1
) * ${glsl(context.grainStrength)};
worldFabricAnisotropic += sin(
  (worldFabricP.x + worldFabricP.z * 0.37) * ${glsl(context.sedimentFrequency)}
  + worldFabricMacro * 3.8
) * ${glsl(context.sedimentStrength)};
float worldFabricValue =
  (worldFabricMacro - 0.5) * ${glsl(profile.albedoMacro)}
  + (worldFabricMeso - 0.5) * ${glsl(profile.albedoMeso)}
  + (worldFabricFine - 0.5) * ${glsl(profile.albedoFine)}
  + worldFabricAnisotropic * 0.035;
diffuseColor.rgb *= 1.0 + worldFabricValue;
float worldFabricDamp = worldFabricMoist
  * (0.72 + (1.0 - worldFabricRoughDomain) * 0.28);
diffuseColor.rgb *= 1.0 - worldFabricDamp * ${glsl(profile.dampGain)};
float worldFabricBleach = worldFabricExposure
  * (${glsl(context.aridity)} * 0.024 + ${glsl(context.frost)} * 0.020);
diffuseColor.rgb *= 1.0 + worldFabricBleach;
float worldFabricBiology =
  ${glsl(context.moss)} * (1.0 - worldFabricExposure) * 0.065
  + ${glsl(context.lichen)} * (0.45 + worldFabricExposure * 0.55) * 0.045;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.34, 0.39, 0.27), clamp(worldFabricBiology, 0.0, 0.09));
float worldFabricOxidation =
  ${glsl(context.oxidation)} * worldFabricVertical
  * (0.55 + worldFabricMeso * 0.45);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.42, 0.24, 0.15), clamp(worldFabricOxidation * 0.12, 0.0, 0.08));
float worldFabricSalt =
  ${glsl(context.salt)} * worldFabricExposure
  * (0.45 + worldFabricFine * 0.55);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.72, 0.72, 0.66), clamp(worldFabricSalt * 0.09, 0.0, 0.06));
float worldFabricCanopy =
  ${glsl(context.canopyMottle)}
  * (worldFabricMeso - 0.5)
  * ${glsl(context.chlorophyllVariation)};
diffuseColor.rgb *= 1.0 + worldFabricCanopy * vec3(-0.22, 0.38, -0.18);`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float worldFabricRoughnessVariation =
  (worldFabricRoughDomain - 0.5) * ${glsl(profile.roughnessMacro)}
  + (worldFabricFine - 0.5) * ${glsl(profile.roughnessFine)}
  + ${glsl(context.weathering)} * 0.025
  + ${glsl(context.frost)} * 0.018
  - worldFabricDamp * 0.055;
roughnessFactor = clamp(roughnessFactor + worldFabricRoughnessVariation, 0.18, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
float worldFabricNormalVariation =
  (worldFabricNormalDomain - 0.5) * 2.0
  * ${glsl(Math.max(0.015, context.normalStrength))}
  * (0.62 + ${glsl(context.lithic)} * 0.38);
vec3 worldFabricTangent = normalize(vec3(worldFabricN.z, 0.0, -worldFabricN.x) + vec3(0.0001,0.0,0.0001));
normal = normalize(normal + worldFabricTangent * worldFabricNormalVariation);`);

    material.userData ||= {};
    material.userData.worldMaterialSurfaceFabricCompileContext = Object.freeze({
      revision: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.revision,
      profileId,
      macroScaleMeters: context.macroScale,
      mesoScaleMeters: context.mesoScale,
      fineScaleMeters: context.fineScale,
      familyProfileApplied: Boolean(material.userData.worldAssetSurfaceResponse),
    });
  };

  material.customProgramCacheKey = () => {
    const inherited = previousKey?.() ?? '';
    const asset = material?.userData?.worldAssetSurfaceResponse;
    const assetKey = asset
      ? `${asset.profileId}:${asset.scales?.macroMeters}:${asset.scales?.mesoMeters}:${asset.scales?.fineMeters}`
      : 'legacy';
    return `${inherited}|world-fabric:${WORLD_MATERIAL_SURFACE_FABRIC_POLICY.revision}:${profileId}:${normalizedSeed}:${assetKey}`;
  };

  material.userData ||= {};
  material.userData.worldMaterialSurfaceFabric = Object.freeze({
    policyId: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.id,
    revision: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.revision,
    profileId,
    seed: normalizedSeed,
    worldSpace: true,
    deterministic: true,
    independentRoughnessDomain: true,
    independentNormalDomain: true,
  });
  material.needsUpdate = true;
  return material;
}

export function applyWorldMaterialSurfaceFabric(root, {
  paletteId = '',
  subject = {},
  seed = null,
  moisture = 0.42,
  exposure = 0.50,
  snow = 0,
  slope = 0,
} = {}) {
  if (!root?.traverse) {
    return Object.freeze({
      policyId: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.id,
      revision: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.revision,
      appliedMaterialCount: 0,
      profileCounts: Object.freeze({}),
    });
  }

  const rootSeed = Number.isFinite(Number(seed))
    ? Number(seed) >>> 0
    : hashString(`${paletteId}|${subject?.id || subject?.name || subject?.src || 'world-asset'}`);
  let materialCount = 0;
  let meshIndex = 0;
  const profileCounts = {};

  root.traverse((mesh) => {
    if (!mesh?.isMesh && !mesh?.isInstancedMesh) return;
    eachMaterial(mesh, (sourceMaterial, materialIndex) => {
      if (!sourceMaterial?.isMaterial) return sourceMaterial;
      const material = cloneMaterialPreservingMaps(sourceMaterial);
      const profileId = inferWorldMaterialSurfaceProfile({
        paletteId,
        subject,
        mesh,
        material,
      });
      const materialSeed = hashString(
        `${rootSeed}|${mesh?.name || meshIndex}|${material?.name || materialIndex}|${profileId}`,
      );
      installFabricShader(material, {
        profileId,
        seed: materialSeed,
        moisture,
        exposure,
        snow,
        slope,
      });
      profileCounts[profileId] = (profileCounts[profileId] ?? 0) + 1;
      materialCount += 1;
      return material;
    });
    meshIndex += 1;
  });

  root.userData ||= {};
  root.userData.worldMaterialSurfaceFabric = Object.freeze({
    policyId: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.id,
    revision: WORLD_MATERIAL_SURFACE_FABRIC_POLICY.revision,
    appliedMaterialCount: materialCount,
    profileCounts: Object.freeze({ ...profileCounts }),
    worldSpace: true,
    deterministic: true,
    sourceShaderHooksPreserved: true,
    placementContextAtCompileTime: true,
    familyProfileContextAtCompileTime: true,
    extraDrawCalls: 0,
  });
  return root.userData.worldMaterialSurfaceFabric;
}
