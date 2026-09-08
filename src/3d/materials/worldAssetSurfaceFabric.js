/*
 * Deterministic world-space micro/macro surface fabric for authored world assets.
 *
 * Material-only: source maps, source UVs, geometry, terrain height, hydrology and placement transforms
 * remain authoritative. This layer breaks visible repeated texture cadence with deterministic world-space
 * multiscale albedo/roughness/normal variation and feeds the same environmental transition model used by the
 * geography placement/material system.
 *
 * @module materials/worldAssetSurfaceFabric
 */

import { sampleWorldAssetTransitionDetail } from '../world/worldAssetTransitionDetail.js';

export const WORLD_ASSET_SURFACE_FABRIC_REVISION = 'v2-world-space-organic-material-fabric-micro-normal-uniform-context';

export const WORLD_ASSET_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'world-asset-surface-fabric-2026-09-08-v3-uniform-context',
  revision: WORLD_ASSET_SURFACE_FABRIC_REVISION,
  renderOnly: true,
  deterministic: true,
  worldSpace: true,
  geometryUnchanged: true,
  sourceMapsPreserved: true,
  sourceUvsPreserved: true,
  canonicalTerrainReadOnly: true,
  canonicalHydrologyReadOnly: true,
  canonicalColliderReadOnly: true,
  newGeographyIntroduced: false,
  usesIrregularBoundaryDetail: true,
  multiscaleNormalVariation: true,
  worldSpaceNormalVariation: true,
  independentNormalDomain: true,
  dynamicSurfaceContextUniforms: true,
  cacheKeyExcludesDynamicSurfaceContext: true,
  worldToViewNormalConversion: true,
  macroScaleMeters: 260,
  mesoScaleMeters: 71,
  patchScaleMeters: 19,
  fineScaleMeters: 4.7,
  grainScaleMeters: 1.35,
  maximumColorDeviation: 0.065,
  maximumRoughnessDeviation: 0.095,
  normalDetailStepMeters: 2.25,
  maximumNormalDeviation: 0.135,
  familyResponseGain: Object.freeze({
    stone: 1.12,
    rock: 1.12,
    soil: 1.06,
    wood: 1.00,
    foliage: 0.84,
    roof: 0.92,
    metal: 0.72,
    cryosphere: 0.78,
    generic: 0.88,
  }),
});

const FAMILY_CODE = Object.freeze({
  generic: 0,
  stone: 1,
  rock: 1,
  soil: 2,
  wood: 3,
  foliage: 4,
  roof: 5,
  metal: 6,
  cryosphere: 7,
});

const finite = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value, 0)));

function familyCode(family) {
  const id = String(family ?? 'generic').trim().toLowerCase();
  return FAMILY_CODE[id] ?? 0;
}

function shaderNumber(value, fallback = 0) {
  const number = finite(value, fallback);
  return Number.isInteger(number) ? String(number) : number.toFixed(6);
}

function installVertexWorldPosition(shader) {
  shader.vertexShader = shader.vertexShader
    .replace(
      '#include <common>',
      '#include <common>\nvarying vec3 vWorldAssetSurfaceFabricPosition;\nvarying vec3 vWorldAssetSurfaceFabricNormal;\n',
    )
    .replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
vec4 worldAssetSurfaceFabricPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
worldAssetSurfaceFabricPosition = instanceMatrix * worldAssetSurfaceFabricPosition;
#endif
vWorldAssetSurfaceFabricPosition = (modelMatrix * worldAssetSurfaceFabricPosition).xyz;
`,
    )
    .replace(
      '#include <beginnormal_vertex>',
      `#include <beginnormal_vertex>
vec3 worldAssetSurfaceFabricObjectNormal = objectNormal;
#ifdef USE_INSTANCING
worldAssetSurfaceFabricObjectNormal = mat3(instanceMatrix) * worldAssetSurfaceFabricObjectNormal;
#endif
vWorldAssetSurfaceFabricNormal = normalize(mat3(modelMatrix) * worldAssetSurfaceFabricObjectNormal);
`,
    );
}

function installFragmentCommon(shader) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <common>',
    `#include <common>
varying vec3 vWorldAssetSurfaceFabricPosition;
varying vec3 vWorldAssetSurfaceFabricNormal;
uniform float worldAssetSurfaceFabricNormalEnergy;
uniform float worldAssetSurfaceFabricMoisture;
uniform float worldAssetSurfaceFabricDryness;
uniform float worldAssetSurfaceFabricFrost;
uniform float worldAssetSurfaceFabricSalt;
uniform float worldAssetSurfaceFabricDamp;
uniform float worldAssetSurfaceFabricDust;
uniform float worldAssetSurfaceFabricMoss;
uniform float worldAssetSurfaceFabricLichen;
uniform float worldAssetSurfaceFabricSediment;
uniform float worldAssetSurfaceFabricWeathering;
uniform float worldAssetSurfaceFabricWind;

float worldAssetSurfaceFabricHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float worldAssetSurfaceFabricNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = worldAssetSurfaceFabricHash(i);
  float b = worldAssetSurfaceFabricHash(i + vec2(1.0, 0.0));
  float c = worldAssetSurfaceFabricHash(i + vec2(0.0, 1.0));
  float d = worldAssetSurfaceFabricHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float worldAssetSurfaceFabricFbm(vec2 p) {
  float total = 0.0;
  float amplitude = 0.54;
  float normalization = 0.0;
  for (int octave = 0; octave < 4; octave++) {
    total += worldAssetSurfaceFabricNoise(p) * amplitude;
    normalization += amplitude;
    p = p * 2.03 + vec2(17.17, -11.43);
    amplitude *= 0.48;
  }
  return total / normalization;
}

float worldAssetSurfaceFabricRidge(vec2 p) {
  float n = worldAssetSurfaceFabricFbm(p);
  return 1.0 - abs(n * 2.0 - 1.0);
}

float worldAssetSurfaceFabricFamilyGain = ${shaderNumber(0.88)};
float worldAssetSurfaceFabricFamilyCode = ${shaderNumber(0.0)};
`,
  );
}

function installColorFragment(shader, constants) {
  const colorInclude = '#include <color_fragment>';
  if (!shader.fragmentShader.includes(colorInclude)) return;
  shader.fragmentShader = shader.fragmentShader.replace(
    colorInclude,
    `${colorInclude}
vec2 worldAssetSurfaceFabricXZ = vWorldAssetSurfaceFabricPosition.xz;
float worldAssetSurfaceFabricMacro = worldAssetSurfaceFabricFbm(worldAssetSurfaceFabricXZ / ${shaderNumber(constants.macroScale, 260.0)} + vec2(2.7, -4.9));
float worldAssetSurfaceFabricMeso = worldAssetSurfaceFabricFbm(worldAssetSurfaceFabricXZ / ${shaderNumber(constants.mesoScale, 71.0)} + vec2(-17.1, 8.2));
float worldAssetSurfaceFabricPatch = worldAssetSurfaceFabricFbm(worldAssetSurfaceFabricXZ / ${shaderNumber(constants.patchScale, 19.0)} + vec2(12.4, 19.7));
float worldAssetSurfaceFabricFine = worldAssetSurfaceFabricNoise(worldAssetSurfaceFabricXZ / ${shaderNumber(constants.fineScale, 4.7)} + vec2(-31.4, 7.6));
float worldAssetSurfaceFabricGrain = worldAssetSurfaceFabricNoise(worldAssetSurfaceFabricXZ / ${shaderNumber(constants.grainScale, 1.35)} + vec2(9.6, -21.2));
float worldAssetSurfaceFabricDirectional = worldAssetSurfaceFabricFbm(vec2(
  dot(worldAssetSurfaceFabricXZ, vec2(0.83, 0.55)) / ${shaderNumber(constants.directionScale, 33.0)},
  dot(worldAssetSurfaceFabricXZ, vec2(-0.55, 0.83)) / ${shaderNumber(constants.crossScale, 11.0)}
) + vec2(4.2, -8.4));
float worldAssetSurfaceFabricNormalSlope = 1.0 - clamp(abs(normalize(vWorldAssetSurfaceFabricNormal).y), 0.0, 1.0);
float worldAssetSurfaceFabricMottle = clamp(
  (worldAssetSurfaceFabricMacro - 0.5) * 0.42
  + (worldAssetSurfaceFabricMeso - 0.5) * 0.28
  + (worldAssetSurfaceFabricPatch - 0.5) * 0.18
  + (worldAssetSurfaceFabricFine - 0.5) * 0.08
  + (worldAssetSurfaceFabricGrain - 0.5) * 0.04,
  -0.5,
  0.5
);
float worldAssetSurfaceFabricWetDark = worldAssetSurfaceFabricDamp * (0.050 + worldAssetSurfaceFabricMoss * 0.032);
float worldAssetSurfaceFabricDryDust = worldAssetSurfaceFabricDryness * worldAssetSurfaceFabricDust * 0.040;
float worldAssetSurfaceFabricSaltBleach = worldAssetSurfaceFabricSalt * 0.028;
float worldAssetSurfaceFabricFrostVeil = worldAssetSurfaceFabricFrost * 0.034;
float worldAssetSurfaceFabricWeatherFade = worldAssetSurfaceFabricWeathering * 0.028;
float worldAssetSurfaceFabricSlopeReveal = worldAssetSurfaceFabricNormalSlope * (0.012 + worldAssetSurfaceFabricWind * 0.015);

vec3 worldAssetSurfaceFabricNeutral = vec3(
  worldAssetSurfaceFabricMottle,
  worldAssetSurfaceFabricMottle * 0.86,
  worldAssetSurfaceFabricMottle * 0.72
) * ${shaderNumber(constants.maximumColorDeviation, 0.065)} * worldAssetSurfaceFabricFamilyGain;

if (worldAssetSurfaceFabricFamilyCode < 2.5) {
  float mineral = (worldAssetSurfaceFabricRidge(worldAssetSurfaceFabricXZ / 23.0 + vec2(3.8, -6.7)) - 0.5) * 0.78;
  float sediment = (worldAssetSurfaceFabricMottle * 0.55 + worldAssetSurfaceFabricSediment * 0.45);
  worldAssetSurfaceFabricNeutral += vec3(mineral * 0.026, mineral * 0.020, mineral * 0.012);
  worldAssetSurfaceFabricNeutral += vec3(sediment * 0.018, sediment * 0.014, sediment * 0.010);
} else if (worldAssetSurfaceFabricFamilyCode < 3.5) {
  float grain = (worldAssetSurfaceFabricDirectional - 0.5) * 0.52;
  worldAssetSurfaceFabricNeutral += vec3(grain * 0.018, grain * 0.014, grain * 0.010);
} else if (worldAssetSurfaceFabricFamilyCode < 4.5) {
  float canopyBreak = (worldAssetSurfaceFabricPatch - 0.5) * 0.50 + (worldAssetSurfaceFabricGrain - 0.5) * 0.18;
  worldAssetSurfaceFabricNeutral += vec3(canopyBreak * 0.014, canopyBreak * 0.022, canopyBreak * 0.010);
} else if (worldAssetSurfaceFabricFamilyCode < 5.5) {
  float roofWear = (worldAssetSurfaceFabricDirectional - 0.5) * 0.34 + (worldAssetSurfaceFabricFrost - 0.5) * 0.14;
  worldAssetSurfaceFabricNeutral += vec3(roofWear * 0.012, roofWear * 0.009, roofWear * 0.006);
} else if (worldAssetSurfaceFabricFamilyCode < 6.5) {
  float oxide = worldAssetSurfaceFabricWeathering * (0.32 + worldAssetSurfaceFabricSalt * 0.68);
  worldAssetSurfaceFabricNeutral += vec3(oxide * 0.022, oxide * 0.010, -oxide * 0.006);
} else {
  float snowGrain = (worldAssetSurfaceFabricMeso - 0.5) * 0.34 + (worldAssetSurfaceFabricFine - 0.5) * 0.14;
  worldAssetSurfaceFabricNeutral += vec3(snowGrain * 0.016);
}

worldAssetSurfaceFabricNeutral += vec3(-worldAssetSurfaceFabricWetDark, -worldAssetSurfaceFabricWetDark * 0.92, -worldAssetSurfaceFabricWetDark * 0.82);
worldAssetSurfaceFabricNeutral += vec3(worldAssetSurfaceFabricDryDust * 0.82, worldAssetSurfaceFabricDryDust * 0.63, worldAssetSurfaceFabricDryDust * 0.42);
worldAssetSurfaceFabricNeutral += vec3(worldAssetSurfaceFabricSaltBleach * 0.76);
worldAssetSurfaceFabricNeutral += vec3(worldAssetSurfaceFabricFrostVeil * 0.82);
worldAssetSurfaceFabricNeutral -= vec3(worldAssetSurfaceFabricWeatherFade * 0.52, worldAssetSurfaceFabricWeatherFade * 0.42, worldAssetSurfaceFabricWeatherFade * 0.32);
worldAssetSurfaceFabricNeutral += vec3(worldAssetSurfaceFabricSlopeReveal * 0.54);
worldAssetSurfaceFabricNeutral += vec3(
  (worldAssetSurfaceFabricLichen - 0.5) * 0.016,
  (worldAssetSurfaceFabricLichen - 0.5) * 0.010,
  -(worldAssetSurfaceFabricLichen - 0.5) * 0.006
);

diffuseColor.rgb = max(vec3(0.0), diffuseColor.rgb + worldAssetSurfaceFabricNeutral);
`,
  );
}

function installRoughnessFragment(shader, constants) {
  const include = '#include <roughnessmap_fragment>';
  if (!shader.fragmentShader.includes(include)) return;
  shader.fragmentShader = shader.fragmentShader.replace(
    include,
    `${include}
float worldAssetSurfaceFabricRoughMacro = worldAssetSurfaceFabricFbm(vWorldAssetSurfaceFabricPosition.xz / ${shaderNumber(constants.macroScale, 260.0)} + vec2(13.1, -7.5));
float worldAssetSurfaceFabricRoughMeso = worldAssetSurfaceFabricFbm(vWorldAssetSurfaceFabricPosition.xz / ${shaderNumber(constants.mesoScale, 71.0)} + vec2(-9.8, 18.2));
float worldAssetSurfaceFabricRoughFine = worldAssetSurfaceFabricNoise(vWorldAssetSurfaceFabricPosition.xz / ${shaderNumber(constants.fineScale, 4.7)} + vec2(27.4, -15.3));
float worldAssetSurfaceFabricRoughDirectional = worldAssetSurfaceFabricRidge(vec2(
  dot(vWorldAssetSurfaceFabricPosition.xz, vec2(0.78, 0.62)) / 27.0,
  dot(vWorldAssetSurfaceFabricPosition.xz, vec2(-0.62, 0.78)) / 9.5
) + vec2(4.2, -2.6));
float worldAssetSurfaceFabricRoughContext = clamp(
  worldAssetSurfaceFabricWeathering * 0.34
  + worldAssetSurfaceFabricDust * 0.12
  + worldAssetSurfaceFabricSalt * 0.12
  + worldAssetSurfaceFabricFrost * 0.12
  + worldAssetSurfaceFabricSediment * 0.10
  + worldAssetSurfaceFabricWind * 0.10
  + (worldAssetSurfaceFabricRoughDirectional - 0.5) * 0.10,
  -0.5,
  0.5
);
float worldAssetSurfaceFabricRoughPattern = (worldAssetSurfaceFabricRoughMacro - 0.5) * 0.060
  + (worldAssetSurfaceFabricRoughMeso - 0.5) * 0.042
  + (worldAssetSurfaceFabricRoughFine - 0.5) * 0.018
  + worldAssetSurfaceFabricRoughContext * ${shaderNumber(constants.maximumRoughnessDeviation, 0.095)};
roughnessFactor = clamp(roughnessFactor + worldAssetSurfaceFabricRoughPattern * worldAssetSurfaceFabricFamilyGain, 0.20, 1.0);
`,
  );
}

function installNormalFragment(shader, constants) {
  const include = '#include <normal_fragment_maps>';
  if (!shader.fragmentShader.includes(include)) return;
  const step = shaderNumber(Math.max(0.85, finite(constants.normalDetailStepMeters, WORLD_ASSET_SURFACE_FABRIC_POLICY.normalDetailStepMeters)), 2.25);
  shader.fragmentShader = shader.fragmentShader.replace(
    include,
    `${include}
vec2 worldAssetSurfaceFabricNormalXZ = vWorldAssetSurfaceFabricPosition.xz;
float worldAssetSurfaceFabricNormalCenter = worldAssetSurfaceFabricFbm(
  worldAssetSurfaceFabricNormalXZ / ${shaderNumber(constants.normalMacroScale, 82.0)} + vec2(6.1, -13.7)
);
float worldAssetSurfaceFabricNormalMeso = worldAssetSurfaceFabricFbm(
  worldAssetSurfaceFabricNormalXZ / ${shaderNumber(constants.normalMesoScale, 18.0)} + vec2(-11.9, 23.4)
);
float worldAssetSurfaceFabricNormalFine = worldAssetSurfaceFabricNoise(
  worldAssetSurfaceFabricNormalXZ / ${shaderNumber(constants.normalFineScale, 3.2)} + vec2(17.6, -5.8)
);
float worldAssetSurfaceFabricNormalDirectional = worldAssetSurfaceFabricFbm(vec2(
  dot(worldAssetSurfaceFabricNormalXZ, vec2(0.91, 0.41)) / 29.0,
  dot(worldAssetSurfaceFabricNormalXZ, vec2(-0.41, 0.91)) / 8.6
) + vec2(-4.7, 12.2));
float worldAssetSurfaceFabricNormalStep = ${step};
float worldAssetSurfaceFabricNormalMacroX = worldAssetSurfaceFabricFbm(
  (worldAssetSurfaceFabricNormalXZ + vec2(worldAssetSurfaceFabricNormalStep, 0.0)) / ${shaderNumber(constants.normalMacroScale, 82.0)} + vec2(6.1, -13.7)
);
float worldAssetSurfaceFabricNormalMacroZ = worldAssetSurfaceFabricFbm(
  (worldAssetSurfaceFabricNormalXZ + vec2(0.0, worldAssetSurfaceFabricNormalStep)) / ${shaderNumber(constants.normalMacroScale, 82.0)} + vec2(6.1, -13.7)
);
float worldAssetSurfaceFabricNormalMesoX = worldAssetSurfaceFabricFbm(
  (worldAssetSurfaceFabricNormalXZ + vec2(worldAssetSurfaceFabricNormalStep, 0.0)) / ${shaderNumber(constants.normalMesoScale, 18.0)} + vec2(-11.9, 23.4)
);
float worldAssetSurfaceFabricNormalMesoZ = worldAssetSurfaceFabricFbm(
  (worldAssetSurfaceFabricNormalXZ + vec2(0.0, worldAssetSurfaceFabricNormalStep)) / ${shaderNumber(constants.normalMesoScale, 18.0)} + vec2(-11.9, 23.4)
);
float worldAssetSurfaceFabricNormalFineX = worldAssetSurfaceFabricNoise(
  (worldAssetSurfaceFabricNormalXZ + vec2(worldAssetSurfaceFabricNormalStep, 0.0)) / ${shaderNumber(constants.normalFineScale, 3.2)} + vec2(17.6, -5.8)
);
float worldAssetSurfaceFabricNormalFineZ = worldAssetSurfaceFabricNoise(
  (worldAssetSurfaceFabricNormalXZ + vec2(0.0, worldAssetSurfaceFabricNormalStep)) / ${shaderNumber(constants.normalFineScale, 3.2)} + vec2(17.6, -5.8)
);
float worldAssetSurfaceFabricNormalDirectionalX = worldAssetSurfaceFabricFbm(vec2(
  dot(worldAssetSurfaceFabricNormalXZ + vec2(worldAssetSurfaceFabricNormalStep, 0.0), vec2(0.91, 0.41)) / 29.0,
  dot(worldAssetSurfaceFabricNormalXZ + vec2(worldAssetSurfaceFabricNormalStep, 0.0), vec2(-0.41, 0.91)) / 8.6
) + vec2(-4.7, 12.2));
float worldAssetSurfaceFabricNormalDirectionalZ = worldAssetSurfaceFabricFbm(vec2(
  dot(worldAssetSurfaceFabricNormalXZ + vec2(0.0, worldAssetSurfaceFabricNormalStep), vec2(0.91, 0.41)) / 29.0,
  dot(worldAssetSurfaceFabricNormalXZ + vec2(0.0, worldAssetSurfaceFabricNormalStep), vec2(-0.41, 0.91)) / 8.6
) + vec2(-4.7, 12.2));

float worldAssetSurfaceFabricNormalGradientX =
  (worldAssetSurfaceFabricNormalMacroX - worldAssetSurfaceFabricNormalCenter) * 0.78
  + (worldAssetSurfaceFabricNormalMesoX - worldAssetSurfaceFabricNormalMeso) * 0.46
  + (worldAssetSurfaceFabricNormalFineX - worldAssetSurfaceFabricNormalFine) * 0.19
  + (worldAssetSurfaceFabricNormalDirectionalX - worldAssetSurfaceFabricNormalDirectional) * 0.31;
float worldAssetSurfaceFabricNormalGradientZ =
  (worldAssetSurfaceFabricNormalMacroZ - worldAssetSurfaceFabricNormalCenter) * 0.78
  + (worldAssetSurfaceFabricNormalMesoZ - worldAssetSurfaceFabricNormalMeso) * 0.46
  + (worldAssetSurfaceFabricNormalFineZ - worldAssetSurfaceFabricNormalFine) * 0.19
  + (worldAssetSurfaceFabricNormalDirectionalZ - worldAssetSurfaceFabricNormalDirectional) * 0.31;

float worldAssetSurfaceFabricNormalFamilyGain = 1.0;
if (worldAssetSurfaceFabricFamilyCode < 1.5) {
  worldAssetSurfaceFabricNormalFamilyGain = 1.22;
} else if (worldAssetSurfaceFabricFamilyCode < 2.5) {
  worldAssetSurfaceFabricNormalFamilyGain = 1.08;
} else if (worldAssetSurfaceFabricFamilyCode < 3.5) {
  worldAssetSurfaceFabricNormalFamilyGain = 0.98;
} else if (worldAssetSurfaceFabricFamilyCode < 4.5) {
  worldAssetSurfaceFabricNormalFamilyGain = 0.76;
} else if (worldAssetSurfaceFabricFamilyCode < 5.5) {
  worldAssetSurfaceFabricNormalFamilyGain = 0.84;
} else if (worldAssetSurfaceFabricFamilyCode < 6.5) {
  worldAssetSurfaceFabricNormalFamilyGain = 0.58;
} else {
  worldAssetSurfaceFabricNormalFamilyGain = 0.80;
}

float worldAssetSurfaceFabricNormalMaterialBias = clamp(
  0.58
  + worldAssetSurfaceFabricDryness * 0.13
  + worldAssetSurfaceFabricWeathering * 0.15
  + worldAssetSurfaceFabricWind * 0.08
  + worldAssetSurfaceFabricFrost * 0.10
  + worldAssetSurfaceFabricSalt * 0.05
  + worldAssetSurfaceFabricSediment * 0.08,
  0.46,
  0.96
);
float worldAssetSurfaceFabricNormalSlopeBias = mix(0.74, 1.12,
  1.0 - clamp(abs(normalize(vWorldAssetSurfaceFabricNormal).y), 0.0, 1.0)
);
float worldAssetSurfaceFabricNormalAmplitude = clamp(
  worldAssetSurfaceFabricNormalEnergy
  * worldAssetSurfaceFabricNormalFamilyGain
  * worldAssetSurfaceFabricNormalMaterialBias
  * worldAssetSurfaceFabricNormalSlopeBias
  * (0.74 + worldAssetSurfaceFabricFamilyGain * 0.26),
  0.0,
  ${shaderNumber(constants.maximumNormalDeviation, 0.135)}
);

vec3 worldAssetSurfaceFabricNormalBaseWorld = normalize(vWorldAssetSurfaceFabricNormal);
vec3 worldAssetSurfaceFabricNormalGradientWorld = vec3(
  -worldAssetSurfaceFabricNormalGradientX,
  0.0,
  -worldAssetSurfaceFabricNormalGradientZ
) * worldAssetSurfaceFabricNormalAmplitude;
worldAssetSurfaceFabricNormalGradientWorld -= worldAssetSurfaceFabricNormalBaseWorld
  * dot(worldAssetSurfaceFabricNormalGradientWorld, worldAssetSurfaceFabricNormalBaseWorld);

float worldAssetSurfaceFabricCrustSignal = worldAssetSurfaceFabricRidge(
  worldAssetSurfaceFabricNormalXZ / 11.5 + vec2(3.6, -8.1)
);
float worldAssetSurfaceFabricCrackSignal = worldAssetSurfaceFabricRidge(
  vec2(
    dot(worldAssetSurfaceFabricNormalXZ, vec2(0.82, 0.57)) / 7.4,
    dot(worldAssetSurfaceFabricNormalXZ, vec2(-0.57, 0.82)) / 2.65
  ) + vec2(-12.3, 6.8)
);
float worldAssetSurfaceFabricMicroEdge = smoothstep(0.64, 0.90,
  worldAssetSurfaceFabricCrustSignal * 0.55 + worldAssetSurfaceFabricCrackSignal * 0.45
);
float worldAssetSurfaceFabricLithicResponse = smoothstep(0.5, 1.0,
  worldAssetSurfaceFabricFamilyCode < 3.0 ? 1.0 : 0.0
);
float worldAssetSurfaceFabricCryosphereResponse = worldAssetSurfaceFabricFamilyCode > 6.5 ? 1.0 : 0.0;
vec3 worldAssetSurfaceFabricMicroEdgeWorld = vec3(
  -worldAssetSurfaceFabricNormalGradientZ,
  0.0,
  worldAssetSurfaceFabricNormalGradientX
) * worldAssetSurfaceFabricMicroEdge
  * worldAssetSurfaceFabricNormalAmplitude
  * (0.18 + worldAssetSurfaceFabricLithicResponse * 0.42 + worldAssetSurfaceFabricCryosphereResponse * 0.16);
worldAssetSurfaceFabricMicroEdgeWorld -= worldAssetSurfaceFabricNormalBaseWorld
  * dot(worldAssetSurfaceFabricMicroEdgeWorld, worldAssetSurfaceFabricNormalBaseWorld);

vec3 worldAssetSurfaceFabricViewPerturb = mat3(viewMatrix)
  * (worldAssetSurfaceFabricNormalGradientWorld + worldAssetSurfaceFabricMicroEdgeWorld);
normal = normalize(normal + worldAssetSurfaceFabricViewPerturb);
`,
  );
}

function compileConstants(context, family, options = {}) {
  const ecology = context?.ecology ?? context?.transition ?? {};
  const transition = options.transitionDetail?.material ?? {};
  const blend = (a, b, amount) => a * (1 - amount) + b * amount;
  const source = {
    moisture: clamp01(context?.moisture ?? ecology.moisture ?? 0.5),
    dryness: clamp01(context?.dry ?? ecology.aridity ?? 0.5),
    frost: blend(clamp01(context?.snow ?? ecology.frost ?? 0), clamp01(transition.frost ?? 0), 0.24),
    salt: blend(clamp01(context?.coast ?? ecology.coastal ?? 0), clamp01(transition.salt ?? 0), 0.32),
    damp: blend(clamp01(context?.wet ?? ecology.moisture ?? 0.5), clamp01(transition.wet ?? ecology.moisture ?? 0.5), 0.26),
    dust: blend(clamp01(context?.roadDust ?? 0), clamp01(transition.dust ?? 0), 0.32),
    moss: blend(clamp01(ecology.moss ?? 0), clamp01(transition.moss ?? 0), 0.28),
    lichen: blend(clamp01(ecology.lichen ?? 0), clamp01(transition.lichen ?? 0), 0.28),
    sediment: blend(clamp01(ecology.sedimentFabric ?? 0), clamp01(transition.sedimentFabric ?? 0), 0.36),
    weathering: blend(clamp01(ecology.weathering ?? 0), clamp01(transition.weathering ?? 0), 0.34),
    wind: clamp01(ecology.exposure ?? context?.exposure ?? 0.5),
  };
  const material = options.materialResponse ?? {};
  const configuredGain = finite(options.familyGain, WORLD_ASSET_SURFACE_FABRIC_POLICY.familyResponseGain[family] ?? 0.88);
  return Object.freeze({
    ...source,
    familyCode: familyCode(family),
    familyGain: Math.max(0.45, Math.min(1.18, configuredGain)),
    macroScale: Math.max(24, finite(options.macroScale, WORLD_ASSET_SURFACE_FABRIC_POLICY.macroScaleMeters)),
    mesoScale: Math.max(12, finite(options.mesoScale, WORLD_ASSET_SURFACE_FABRIC_POLICY.mesoScaleMeters)),
    patchScale: Math.max(5, finite(options.patchScale, WORLD_ASSET_SURFACE_FABRIC_POLICY.patchScaleMeters)),
    fineScale: Math.max(1.2, finite(options.fineScale, WORLD_ASSET_SURFACE_FABRIC_POLICY.fineScaleMeters)),
    grainScale: Math.max(0.45, finite(options.grainScale, WORLD_ASSET_SURFACE_FABRIC_POLICY.grainScaleMeters)),
    directionScale: Math.max(10, finite(options.directionScale, 33)),
    crossScale: Math.max(4, finite(options.crossScale, 11)),
    normalEnergy: clamp01(material.normalEnergy ?? ecology.normalFine ?? 0.5),
    normalDetailStepMeters: Math.max(0.85, finite(options.normalDetailStepMeters, WORLD_ASSET_SURFACE_FABRIC_POLICY.normalDetailStepMeters)),
    normalMacroScale: Math.max(48, finite(options.normalMacroScale, 82)),
    normalMesoScale: Math.max(10, finite(options.normalMesoScale, 18)),
    normalFineScale: Math.max(1.0, finite(options.normalFineScale, 3.2)),
    maximumColorDeviation: Math.max(0, finite(options.maximumColorDeviation, WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumColorDeviation)),
    maximumRoughnessDeviation: Math.max(0, finite(options.maximumRoughnessDeviation, WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumRoughnessDeviation)),
    maximumNormalDeviation: Math.max(0, finite(options.maximumNormalDeviation, WORLD_ASSET_SURFACE_FABRIC_POLICY.maximumNormalDeviation)),
  });
}

const DYNAMIC_UNIFORM_NAMES = Object.freeze([
  'worldAssetSurfaceFabricNormalEnergy',
  'worldAssetSurfaceFabricMoisture',
  'worldAssetSurfaceFabricDryness',
  'worldAssetSurfaceFabricFrost',
  'worldAssetSurfaceFabricSalt',
  'worldAssetSurfaceFabricDamp',
  'worldAssetSurfaceFabricDust',
  'worldAssetSurfaceFabricMoss',
  'worldAssetSurfaceFabricLichen',
  'worldAssetSurfaceFabricSediment',
  'worldAssetSurfaceFabricWeathering',
  'worldAssetSurfaceFabricWind',
]);

function assignDynamicUniforms(shader, constants) {
  const values = {
    worldAssetSurfaceFabricNormalEnergy: constants.normalEnergy,
    worldAssetSurfaceFabricMoisture: constants.moisture,
    worldAssetSurfaceFabricDryness: constants.dryness,
    worldAssetSurfaceFabricFrost: constants.frost,
    worldAssetSurfaceFabricSalt: constants.salt,
    worldAssetSurfaceFabricDamp: constants.damp,
    worldAssetSurfaceFabricDust: constants.dust,
    worldAssetSurfaceFabricMoss: constants.moss,
    worldAssetSurfaceFabricLichen: constants.lichen,
    worldAssetSurfaceFabricSediment: constants.sediment,
    worldAssetSurfaceFabricWeathering: constants.weathering,
    worldAssetSurfaceFabricWind: constants.wind,
  };
  shader.uniforms ||= {};
  for (const [name, value] of Object.entries(values)) shader.uniforms[name] = { value };
}

export function installWorldAssetSurfaceFabric(material, context = {}, {
  family = 'generic',
  materialResponse = null,
  transitionDetail = null,
  customProgramSuffix = '',
} = {}) {
  if (!material || typeof material.onBeforeCompile !== 'function') {
    return { ok: false, error: 'material-does-not-support-shader-hook' };
  }
  if (material.userData?.worldAssetSurfaceFabric?.installed) {
    return { ok: true, policyId: WORLD_ASSET_SURFACE_FABRIC_POLICY.id, alreadyInstalled: true };
  }

  const resolvedTransitionDetail = transitionDetail ?? (
    Number.isFinite(Number(context?.x)) && Number.isFinite(Number(context?.z))
      ? sampleWorldAssetTransitionDetail({
        x: context.x,
        z: context.z,
        seed: context.seed,
        coastDistance: context.coastDistance,
        riverDistance: context.riverDistance,
        lakeDistance: context.lakeDistance,
        roadDistance: context.roadDistance,
        settlementDistance: context.settlementDistance,
        moisture: context.moisture,
        shelter: context.ecology?.shelter,
        exposure: context.ecology?.exposure,
        erosion: context.ecology?.erosion,
        deposition: context.ecology?.deposition,
        lithic: context.ecology?.lithic,
        slopeDegrees: context.slopeDegrees,
        snow: context.snow,
        biome: context.biomeId,
      },
      { seed: finite(context.seed, 0), family },
    )
      : null
  );

  const constants = compileConstants(context, family, {
    materialResponse: materialResponse ?? {},
    transitionDetail: resolvedTransitionDetail,
    familyGain: WORLD_ASSET_SURFACE_FABRIC_POLICY.familyResponseGain[family],
  });
  const previousOnBeforeCompile = typeof material.onBeforeCompile === 'function'
    ? material.onBeforeCompile.bind(material)
    : null;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);
    installVertexWorldPosition(shader);
    installFragmentCommon(shader);
    assignDynamicUniforms(shader, constants);
    installColorFragment(shader, constants);
    installRoughnessFragment(shader, constants);
    installNormalFragment(shader, constants);
  };
  material.customProgramCacheKey = () => `${WORLD_ASSET_SURFACE_FABRIC_POLICY.id}:${familyCode(family)}:${customProgramSuffix}`;
  material.userData ||= {};
  material.userData.worldAssetSurfaceFabric = Object.freeze({
    installed: true,
    policyId: WORLD_ASSET_SURFACE_FABRIC_POLICY.id,
    revision: WORLD_ASSET_SURFACE_FABRIC_REVISION,
    family,
    worldSpace: true,
    sourceMapsPreserved: true,
    sourceUvsPreserved: true,
    deterministic: true,
    irregularBoundaryDetail: Boolean(resolvedTransitionDetail),
    transitionDetailPolicyId: resolvedTransitionDetail?.policyId ?? null,
    dynamicSurfaceContextUniforms: true,
    cacheKeyExcludesDynamicSurfaceContext: true,
    dynamicUniformNames: DYNAMIC_UNIFORM_NAMES,
    worldToViewNormalConversion: true,
    maximumColorDeviation: constants.maximumColorDeviation,
    maximumRoughnessDeviation: constants.maximumRoughnessDeviation,
    maximumNormalDeviation: constants.maximumNormalDeviation,
    normalDetailStepMeters: constants.normalDetailStepMeters,
    normalEnergy: constants.normalEnergy,
  });
  material.needsUpdate = true;
  return { ok: true, policyId: WORLD_ASSET_SURFACE_FABRIC_POLICY.id, constants, dynamicUniformNames: DYNAMIC_UNIFORM_NAMES };
}

export function worldAssetSurfaceFabricConstants(context = {}, family = 'generic', options = {}) {
  return compileConstants(context, family, options);
}

export function worldAssetSurfaceFabricPolicy() {
  return WORLD_ASSET_SURFACE_FABRIC_POLICY;
}

export function worldAssetSurfaceFabricRevision() {
  return WORLD_ASSET_SURFACE_FABRIC_REVISION;
}
