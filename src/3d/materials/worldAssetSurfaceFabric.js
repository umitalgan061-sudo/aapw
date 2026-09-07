/**
 * Render-only world-space weathering for authored environment/model materials.
 *
 * The fabric deliberately stays downstream of asset hydration and terrain placement. It never edits
 * geometry, map/Pindex height, hydrology, roads, settlements or colliders. Its job is to prevent a
 * valid authored mesh from reading like a single sampled bitmap: broad climate/weathering fields,
 * meso-scale breakup and micro-scale normal/roughness response are evaluated in world space so the
 * same model remains visually coherent when instanced across a large geography.
 *
 * @module materials/worldAssetSurfaceFabric
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(Number(value)) ? Number(value) : 0));

export const WORLD_ASSET_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'world-asset-surface-fabric-2026-09-07-v1',
  renderOnly: true,
  deterministic: true,
  worldSpace: true,
  canonicalGeographyUntouched: true,
  multiScaleAlbedo: true,
  multiScaleRoughness: true,
  microNormal: true,
  nonPeriodicMacroField: true,
  weatheringFieldsMeters: Object.freeze([2400, 1200, 560, 220, 92, 38, 14]),
  normalAmplitude: 0.085,
  roughnessAmplitude: 0.16,
  albedoAmplitude: 0.12,
});

function familyCode(family) {
  const key = String(family || '').toLowerCase();
  if (/(rock|cliff|boulder|stone|moraine|scree)/.test(key)) return 1;
  if (/(tree|vegetation|foliage|leaf|pine|shrub|grass)/.test(key)) return 2;
  if (/(snow|ice|glacier|frost)/.test(key)) return 3;
  if (/(water|river|lake|ocean|shore)/.test(key)) return 4;
  if (/(road|path|dirt)/.test(key)) return 5;
  if (/(roof|timber|wood)/.test(key)) return 6;
  return 0;
}

function surfaceCode(surface) {
  const key = String(surface || '').toLowerCase();
  if (/(bark|trunk|wood)/.test(key)) return 1;
  if (/(leaf|foliage|grass|moss)/.test(key)) return 2;
  if (/(rock|stone|cliff|scree)/.test(key)) return 3;
  if (/(snow|ice)/.test(key)) return 4;
  if (/(roof|slate)/.test(key)) return 5;
  if (/(road|path|soil|dirt)/.test(key)) return 6;
  return 0;
}

function stableVariantPhase(variant) {
  let hash = 2166136261;
  const text = String(variant || '');
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

/**
 * Installs the shared render-only fabric on a MeshStandardMaterial.
 * @param {import('three').MeshStandardMaterial} material
 * @param {object} options
 * @param {string} [options.family]
 * @param {string} [options.surface]
 * @param {string} [options.variant]
 */
export function applyWorldAssetSurfaceFabric(material, {
  family = '',
  surface = '',
  variant = '',
} = {}) {
  if (!material) return material;
  const familyId = familyCode(family);
  const surfaceId = surfaceCode(surface);
  const phase = stableVariantPhase(variant);
  const key = `${WORLD_ASSET_SURFACE_FABRIC_POLICY.id}:${familyId}:${surfaceId}:${phase.toFixed(6)}`;

  material.userData ||= {};
  material.userData.worldAssetSurfaceFabric = Object.freeze({
    policyId: WORLD_ASSET_SURFACE_FABRIC_POLICY.id,
    family: String(family || ''),
    surface: String(surface || ''),
    familyId,
    surfaceId,
    variantPhase: phase,
    worldSpace: true,
    renderOnly: true,
  });

  const previousOnBeforeCompile = material.onBeforeCompile?.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile?.(shader, renderer);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vWorldAssetFabricPosition;\nvarying vec3 vWorldAssetFabricNormal;',
      )
      .replace(
        '#include <beginnormal_vertex>',
        '#include <beginnormal_vertex>\nvWorldAssetFabricNormal = normalize(mat3(modelMatrix) * objectNormal);',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vec4 worldAssetFabricLocalPosition = vec4(transformed, 1.0);
#ifdef USE_INSTANCING
worldAssetFabricLocalPosition = instanceMatrix * worldAssetFabricLocalPosition;
#endif
vWorldAssetFabricPosition = (modelMatrix * worldAssetFabricLocalPosition).xyz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec3 vWorldAssetFabricPosition;
varying vec3 vWorldAssetFabricNormal;
const float WORLD_ASSET_FAMILY = ${familyId.toFixed(1)};
const float WORLD_ASSET_SURFACE = ${surfaceId.toFixed(1)};
const float WORLD_ASSET_PHASE = ${phase.toFixed(6)};
float worldAssetFabricHash(vec2 p) {
  p = fract(p * vec2(0.1031, 0.1030));
  p += dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float worldAssetFabricNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = worldAssetFabricHash(i);
  float b = worldAssetFabricHash(i + vec2(1.0, 0.0));
  float c = worldAssetFabricHash(i + vec2(0.0, 1.0));
  float d = worldAssetFabricHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float worldAssetFabricFbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.56;
  float total = 0.0;
  for (int octave = 0; octave < 5; octave++) {
    value += worldAssetFabricNoise(p) * amplitude;
    total += amplitude;
    p = p * 2.017 + vec2(19.17, -13.41);
    amplitude *= 0.49;
  }
  return value / total;
}
float worldAssetFabricRidge(vec2 p) {
  float n = worldAssetFabricFbm(p);
  return 1.0 - abs(n * 2.0 - 1.0);
}
float worldAssetFabricBand(vec2 p) {
  float a = worldAssetFabricFbm(p);
  float b = worldAssetFabricFbm(p * 0.71 + vec2(8.2, -6.7));
  return smoothstep(0.27, 0.78, a * 0.64 + b * 0.36);
}
float worldAssetFabricVerticalStain(vec3 p) {
  float along = worldAssetFabricFbm(p.xz / 74.0 + vec2(p.y * 0.0061, -p.y * 0.0043));
  float vertical = 1.0 - smoothstep(0.0, 1.0, fract(p.y * 0.018 + along * 0.21));
  return smoothstep(0.34, 0.82, along) * vertical;
}`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
vec3 worldAssetFabricBase = diffuseColor.rgb;
vec3 worldAssetFabricPos = vWorldAssetFabricPosition;
vec3 worldAssetFabricN = normalize(vWorldAssetFabricNormal);
float worldAssetFabricSlope = 1.0 - clamp(abs(worldAssetFabricN.y), 0.0, 1.0);
float worldAssetFabricHeight = worldAssetFabricPos.y;
vec2 worldAssetFabricXZ = worldAssetFabricPos.xz;
vec2 worldAssetFabricWarp = (vec2(
  worldAssetFabricFbm(worldAssetFabricXZ / 1100.0 + vec2(17.1, -4.6)),
  worldAssetFabricFbm(worldAssetFabricXZ / 870.0 + vec2(-11.4, 9.7))
) - 0.5) * 420.0;
float worldAssetFabricMacro = worldAssetFabricFbm((worldAssetFabricXZ + worldAssetFabricWarp) / 2400.0 + vec2(3.2, -17.7));
float worldAssetFabricBroad = worldAssetFabricFbm((worldAssetFabricXZ + worldAssetFabricWarp * 0.72) / 1200.0 + vec2(-8.8, 21.4));
float worldAssetFabricLandform = worldAssetFabricFbm((worldAssetFabricXZ + worldAssetFabricWarp * 0.44) / 560.0 + vec2(16.2, 5.1));
float worldAssetFabricMeso = worldAssetFabricFbm(worldAssetFabricXZ / 220.0 + vec2(29.4, -12.3));
float worldAssetFabricFine = worldAssetFabricFbm(worldAssetFabricXZ / 92.0 + vec2(-31.8, 7.4));
float worldAssetFabricGrain = worldAssetFabricNoise(worldAssetFabricXZ / 38.0 + vec2(4.9, -18.6));
float worldAssetFabricHumidity = clamp(0.50 + (0.5 - worldAssetFabricMacro) * 0.31 + (0.5 - worldAssetFabricBroad) * 0.25 + (0.5 - worldAssetFabricLandform) * 0.15, 0.0, 1.0);
float worldAssetFabricCavity = worldAssetFabricRidge(worldAssetFabricXZ / 46.0 + vec2(12.9, -7.2));
float worldAssetFabricStain = worldAssetFabricVerticalStain(worldAssetFabricPos);
float worldAssetFabricWear = smoothstep(0.25, 0.78, worldAssetFabricFine * 0.63 + worldAssetFabricGrain * 0.37);
float worldAssetFabricRock = WORLD_ASSET_FAMILY == 1.0 ? 1.0 : smoothstep(0.18, 0.34, 1.0 - abs(worldAssetFabricBase.g - worldAssetFabricBase.r));
float worldAssetFabricVegetation = WORLD_ASSET_FAMILY == 2.0 ? 1.0 : smoothstep(0.01, 0.12, worldAssetFabricBase.g - max(worldAssetFabricBase.r, worldAssetFabricBase.b));
float worldAssetFabricSnow = WORLD_ASSET_FAMILY == 3.0 ? 1.0 : smoothstep(0.58, 0.86, dot(worldAssetFabricBase, vec3(0.2126, 0.7152, 0.0722)));
float worldAssetFabricVertical = smoothstep(0.12, 0.74, worldAssetFabricSlope) * worldAssetFabricStain;
float worldAssetFabricMoss = worldAssetFabricHumidity * (1.0 - smoothstep(0.42, 0.86, worldAssetFabricHeight * 0.0015 + 0.35)) * (0.55 + worldAssetFabricCavity * 0.45);
float worldAssetFabricDust = (1.0 - worldAssetFabricHumidity) * (0.45 + worldAssetFabricWear * 0.55);
float worldAssetFabricSalt = smoothstep(0.58, 0.88, worldAssetFabricHumidity) * (1.0 - smoothstep(0.20, 0.50, worldAssetFabricSlope));
float worldAssetFabricBreakup = (worldAssetFabricMacro - 0.5) * 0.52
  + (worldAssetFabricBroad - 0.5) * 0.34
  + (worldAssetFabricLandform - 0.5) * 0.24
  + (worldAssetFabricMeso - 0.5) * 0.13
  + (worldAssetFabricGrain - 0.5) * 0.06;
vec3 worldAssetFabricWeathered = worldAssetFabricBase;
worldAssetFabricWeathered *= 1.0 + worldAssetFabricBreakup * ${WORLD_ASSET_SURFACE_FABRIC_POLICY.albedoAmplitude.toFixed(3)};
worldAssetFabricWeathered *= 1.0 - worldAssetFabricDust * 0.035;
worldAssetFabricWeathered = mix(worldAssetFabricWeathered, worldAssetFabricWeathered * vec3(0.82, 0.90, 0.76), worldAssetFabricMoss * (0.14 + 0.16 * worldAssetFabricVegetation));
worldAssetFabricWeathered = mix(worldAssetFabricWeathered, worldAssetFabricWeathered * vec3(0.88, 0.90, 0.91), worldAssetFabricSalt * (0.04 + 0.06 * worldAssetFabricRock));
worldAssetFabricWeathered *= 1.0 - worldAssetFabricVertical * 0.075;
worldAssetFabricWeathered *= 0.94 + worldAssetFabricSnow * 0.08;
worldAssetFabricWeathered = mix(worldAssetFabricWeathered, mix(worldAssetFabricWeathered, vec3(dot(worldAssetFabricWeathered, vec3(0.2126, 0.7152, 0.0722))), 0.10), 0.08 + 0.09 * worldAssetFabricRock);
diffuseColor.rgb = clamp(worldAssetFabricWeathered, 0.0, 1.0);`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        `#include <roughnessmap_fragment>
float worldAssetFabricRoughnessNoise = worldAssetFabricFbm(worldAssetFabricXZ / 62.0 + vec2(WORLD_ASSET_PHASE * 31.0, -WORLD_ASSET_PHASE * 19.0));
float worldAssetFabricWetPolish = smoothstep(0.58, 0.92, worldAssetFabricHumidity) * (1.0 - smoothstep(0.18, 0.55, worldAssetFabricSlope));
float worldAssetFabricDryDust = smoothstep(0.58, 0.92, 1.0 - worldAssetFabricHumidity) * (0.45 + 0.55 * worldAssetFabricWear);
float worldAssetFabricRoughnessDelta = (worldAssetFabricRoughnessNoise - 0.5) * ${WORLD_ASSET_SURFACE_FABRIC_POLICY.roughnessAmplitude.toFixed(3)};
roughnessFactor = clamp(roughnessFactor + roughnessFactor * worldAssetFabricRoughnessDelta + worldAssetFabricDryDust * 0.045 - worldAssetFabricWetPolish * 0.060, 0.38, 1.0);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        `#include <normal_fragment_maps>
vec2 worldAssetFabricNormalP = worldAssetFabricXZ / 24.0 + vec2(WORLD_ASSET_PHASE * 41.0, -WORLD_ASSET_PHASE * 27.0);
float worldAssetFabricNx = worldAssetFabricNoise(worldAssetFabricNormalP + vec2(0.21, 0.0)) - worldAssetFabricNoise(worldAssetFabricNormalP - vec2(0.21, 0.0));
float worldAssetFabricNz = worldAssetFabricNoise(worldAssetFabricNormalP + vec2(0.0, 0.21)) - worldAssetFabricNoise(worldAssetFabricNormalP - vec2(0.0, 0.21));
float worldAssetFabricNormalStrength = ${WORLD_ASSET_SURFACE_FABRIC_POLICY.normalAmplitude.toFixed(3)} * (0.55 + worldAssetFabricWear * 0.75 + worldAssetFabricRock * 0.34);
normal = normalize(normal + mat3(viewMatrix) * vec3(worldAssetFabricNx, 0.0, worldAssetFabricNz) * worldAssetFabricNormalStrength);`,
      );
  };

  material.customProgramCacheKey = () => key;
  material.needsUpdate = true;
  return material;
}

export function isWorldAssetSurfaceFabricInstalled(material) {
  return Boolean(material?.userData?.worldAssetSurfaceFabric?.policyId === WORLD_ASSET_SURFACE_FABRIC_POLICY.id);
}

export function worldAssetSurfaceFabricDescriptor(material) {
  const descriptor = material?.userData?.worldAssetSurfaceFabric;
  return descriptor ? { ...descriptor } : null;
}

export function surfaceFabricResponseHint({ family = '', slope = 0, moisture = 0.5 } = {}) {
  const familyId = familyCode(family);
  const slopeWeight = clamp01(Number(slope) / 75);
  const moistureWeight = clamp01(moisture);
  return Object.freeze({
    familyId,
    slopeWeight,
    moistureWeight,
    weathering: clamp01(0.25 + slopeWeight * 0.36 + moistureWeight * 0.39),
    preferredRoughnessResponse: familyId === 3 ? 'snow-pack-softened' : familyId === 1 ? 'rock-fracture-high' : 'weathered-pbr',
  });
}
