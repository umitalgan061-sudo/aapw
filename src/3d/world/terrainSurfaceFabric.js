/**
 * Render-only terrain surface fabric for the canonical owner-map terrain.
 *
 * This module is deliberately downstream of terrain height/collider authority. It never edits
 * geometry, map coordinates, water masks or road/settlement positions. Its job is to prevent the
 * current terrain from reading as a single olive/grey sheet when seen from full-world and near-ground
 * cameras by adding deterministic, world-space, non-periodic macro/micro material response.
 *
 * The existing terrainMicroSurface module supplies a 22 m repeated normal/roughness texture. That
 * texture remains useful at close range, but the repeated UV tile is not allowed to be the only visual
 * breakup. This layer adds independent world-space signals at 42 m..3.8 km and blends their response
 * by slope, elevation and substrate so the same detail does not repeat at chunk boundaries.
 *
 * @module world/terrainSurfaceFabric
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;

export const TERRAIN_SURFACE_FABRIC_POLICY = Object.freeze({
  id: 'terrain-world-surface-fabric-nonperiodic-v1',
  renderOnly: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalRoadsUnchanged: true,
  canonicalSettlementsUnchanged: true,
  periodicDetailTextureIsSupplemental: true,
  worldSpaceScalesMeters: Object.freeze([42, 96, 220, 510, 1200, 3800]),
  macroColorStrength: 0.125,
  mesoColorStrength: 0.085,
  fineColorStrength: 0.042,
  substrateContrastStrength: 0.11,
  slopeContrastStrength: 0.09,
  reliefContrastStrength: 0.075,
  moistureContrastStrength: 0.06,
  roughnessVariance: 0.20,
  normalVariance: 0.10,
  detailFadeStartMeters: 22,
  detailFadeEndMeters: 1450,
  snowSurfaceFadeStartMeters: 210,
  snowSurfaceFadeFullMeters: 560,
  rockSurfaceSlopeStart: 0.24,
  rockSurfaceSlopeFull: 0.68,
  wetSurfaceHeightMeters: 8,
  warmSurfaceHeightMeters: 38,
  antiTilingFrequencyA: 0.0065,
  antiTilingFrequencyB: 0.013,
  antiTilingFrequencyC: 0.033,
  shaderKey: 'terrain-world-surface-fabric-nonperiodic-v1',
});

export const TERRAIN_SURFACE_FABRIC_CHANNELS = Object.freeze({
  meadow: Object.freeze({ hueBias: 'green-lowland', roughness: 'soft-grass', macro: 0.74 }),
  dampMoss: Object.freeze({ hueBias: 'deep-olive', roughness: 'wet-organic', macro: 0.86 }),
  dryHeath: Object.freeze({ hueBias: 'brown-olive', roughness: 'dry-fibre', macro: 0.92 }),
  ferricEarth: Object.freeze({ hueBias: 'warm-earth', roughness: 'friable-mineral', macro: 0.97 }),
  granite: Object.freeze({ hueBias: 'cool-stone', roughness: 'hard-mineral', macro: 0.99 }),
  quartz: Object.freeze({ hueBias: 'light-mineral', roughness: 'crystalline', macro: 1.0 }),
  scree: Object.freeze({ hueBias: 'dust-mineral', roughness: 'loose-stone', macro: 0.995 }),
  snow: Object.freeze({ hueBias: 'cold-neutral', roughness: 'powder/pack', macro: 0.94 }),
  shoreline: Object.freeze({ hueBias: 'wet-sediment', roughness: 'wet-mixed', macro: 0.88 }),
});

function hash32(value) {
  let x = value | 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x | 0;
}

function hash2(ix, iz, seed = 0x51f15e) {
  const h = hash32(Math.imul(ix | 0, 0x1f123bb5) ^ Math.imul(iz | 0, 0x5bd1e995) ^ seed);
  return (h >>> 0) / 4294967295;
}

function smooth3(t) {
  return t * t * (3 - 2 * t);
}

function valueNoise2D(x, z, seed = 0x51f15e) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = smooth3(x - ix);
  const fz = smooth3(z - iz);
  const a = hash2(ix, iz, seed);
  const b = hash2(ix + 1, iz, seed);
  const c = hash2(ix, iz + 1, seed);
  const d = hash2(ix + 1, iz + 1, seed);
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

function fbm2D(x, z, seed = 0x51f15e) {
  let sum = 0;
  let weight = 0;
  let amplitude = 0.58;
  let frequency = 1;
  for (let octave = 0; octave < 5; octave += 1) {
    sum += valueNoise2D(x * frequency, z * frequency, seed + octave * 0x9e3779b9) * amplitude;
    weight += amplitude;
    amplitude *= 0.48;
    frequency *= 2.03;
  }
  return sum / weight;
}

function ridged2D(x, z, seed = 0x29ab4d) {
  const n = fbm2D(x, z, seed);
  return 1 - Math.abs(n * 2 - 1);
}

export function terrainSurfaceNoise(worldX, worldZ) {
  const macro = fbm2D(worldX / 1200, worldZ / 1200, 0x13a6);
  const broad = fbm2D(worldX / 520, worldZ / 520, 0x22bd);
  const meso = fbm2D(worldX / 210, worldZ / 210, 0x42d1);
  const fine = fbm2D(worldX / 74, worldZ / 74, 0x61ef);
  const grain = valueNoise2D(worldX / 29, worldZ / 29, 0x74aa);
  return Object.freeze({ macro, broad, meso, fine, grain });
}

export function terrainSurfaceReliefContext({
  worldX = 0,
  worldZ = 0,
  heightAboveSeaMeters = 0,
  slopeDegrees = 0,
  concavityMeters = 0,
  rockWeight = 0,
  snowWeight = 0,
  waterWeight = 0,
  moisture = null,
} = {}) {
  const P = TERRAIN_SURFACE_FABRIC_POLICY;
  const noise = terrainSurfaceNoise(worldX, worldZ);
  const slope01 = clamp01(slopeDegrees / 70);
  const elevation01 = clamp01((heightAboveSeaMeters - 8) / 500);
  const rock01 = clamp01(rockWeight);
  const snow01 = clamp01(snowWeight);
  const water01 = clamp01(waterWeight);
  const wet01 = moisture == null
    ? clamp01(0.42 + (0.5 - noise.macro) * 0.28 + (0.5 - noise.meso) * 0.22 + water01 * 0.36 - elevation01 * 0.16)
    : clamp01(moisture);
  const warm01 = clamp01((heightAboveSeaMeters - P.wetSurfaceHeightMeters) / Math.max(1, P.warmSurfaceHeightMeters - P.wetSurfaceHeightMeters));
  const convex01 = clamp01(concavityMeters / 6);
  const detailDistance01 = clamp01((Math.abs(heightAboveSeaMeters) - P.detailFadeStartMeters) / Math.max(1, P.detailFadeEndMeters - P.detailFadeStartMeters));
  const snowFade = clamp01((heightAboveSeaMeters - P.snowSurfaceFadeStartMeters) / Math.max(1, P.snowSurfaceFadeFullMeters - P.snowSurfaceFadeStartMeters));
  const exposedRock = Math.max(smooth3(clamp01((slopeDegrees - 17) / 40)), rock01 * 0.88);
  const substrate = clamp01(0.16 + exposedRock * 0.62 + snow01 * 0.12 + water01 * 0.08);
  return Object.freeze({
    noise,
    slope01,
    elevation01,
    rock01,
    snow01,
    water01,
    wet01,
    warm01,
    convex01,
    detailDistance01,
    detailVisibility: 1 - smooth3(detailDistance01),
    snowFade,
    exposedRock,
    substrate,
    antiTilingOffset: Object.freeze({
      x: (noise.broad - 0.5) * 240 + (noise.meso - 0.5) * 70,
      z: (noise.macro - 0.5) * 190 - (noise.fine - 0.5) * 55,
    }),
    policyId: P.id,
  });
}

function rgbToLuma(color) {
  return color.r * 0.2126 + color.g * 0.7152 + color.b * 0.0722;
}

export function terrainSurfaceColorMultiplier(context) {
  const c = context;
  const substrateContrast = (c.noise.broad - 0.5) * TERRAIN_SURFACE_FABRIC_POLICY.macroColorStrength;
  const mesoContrast = (c.noise.meso - 0.5) * TERRAIN_SURFACE_FABRIC_POLICY.mesoColorStrength;
  const fineContrast = (c.noise.grain - 0.5) * TERRAIN_SURFACE_FABRIC_POLICY.fineColorStrength;
  const slopeContrast = (c.slope01 - 0.32) * TERRAIN_SURFACE_FABRIC_POLICY.slopeContrastStrength;
  const moistureContrast = (c.wet01 - 0.45) * TERRAIN_SURFACE_FABRIC_POLICY.moistureContrastStrength;
  const reliefContrast = (c.convex01 - 0.50) * TERRAIN_SURFACE_FABRIC_POLICY.reliefContrastStrength;
  const rockContrast = (c.substrate - 0.35) * TERRAIN_SURFACE_FABRIC_POLICY.substrateContrastStrength;
  const total = 1 + substrateContrast + mesoContrast + fineContrast + slopeContrast + moistureContrast + reliefContrast + rockContrast;
  return Math.max(0.72, Math.min(1.28, total));
}

export function terrainSurfaceRoughness(context) {
  const c = context;
  const P = TERRAIN_SURFACE_FABRIC_POLICY;
  const granular = (c.noise.fine - 0.5) * P.roughnessVariance;
  const weathering = c.wet01 * -0.10 + c.rock01 * 0.08 + c.snow01 * 0.02;
  return Math.max(0.48, Math.min(1, 0.84 + granular + weathering));
}

export function terrainSurfaceNormalGain(context) {
  const c = context;
  const P = TERRAIN_SURFACE_FABRIC_POLICY;
  return Math.max(0.02, Math.min(0.18,
    0.045
    + c.slope01 * 0.055
    + c.exposedRock * 0.065
    + (1 - c.snow01) * 0.025
    + c.detailVisibility * P.normalVariance,
  ));
}

export function chooseTerrainSubstrate(context) {
  if (context.water01 > 0.72) return 'shoreline';
  if (context.snow01 > 0.68) return 'snow';
  if (context.exposedRock > 0.72) return context.noise.fine > 0.57 ? 'quartz' : 'granite';
  if (context.exposedRock > 0.50) return 'scree';
  if (context.wet01 > 0.70 && context.elevation01 < 0.18) return 'dampMoss';
  if (context.warm01 > 0.76 && context.wet01 < 0.34) return 'ferricEarth';
  if (context.noise.broad > 0.67 && context.wet01 < 0.52) return 'dryHeath';
  return 'meadow';
}

export function buildTerrainSurfaceManifest({
  sample = {},
  materialPolicyId = TERRAIN_SURFACE_FABRIC_POLICY.id,
  sourceMapPolicyId = null,
} = {}) {
  const context = terrainSurfaceReliefContext(sample);
  return Object.freeze({
    version: 1,
    materialPolicyId,
    sourceMapPolicyId,
    substrate: chooseTerrainSubstrate(context),
    context: {
      slope01: context.slope01,
      elevation01: context.elevation01,
      moisture: context.wet01,
      rock01: context.rock01,
      snow01: context.snow01,
      water01: context.water01,
      detailVisibility: context.detailVisibility,
    },
    response: {
      colorMultiplier: terrainSurfaceColorMultiplier(context),
      roughness: terrainSurfaceRoughness(context),
      normalGain: terrainSurfaceNormalGain(context),
    },
    antiTiling: {
      worldSpace: true,
      repeatedTextureIsSupplemental: true,
      offsetX: context.antiTilingOffset.x,
      offsetZ: context.antiTilingOffset.z,
    },
    canonical: {
      heightUnchanged: true,
      hydrologyUnchanged: true,
      colliderUnchanged: true,
      routeUnchanged: true,
      settlementUnchanged: true,
    },
  });
}

const SHADER_COMMON = `
float terrainSurfaceFabricHash(vec2 p) {
  p = fract(p * vec2(127.1, 311.7));
  p += dot(p, p + 33.33);
  return fract((p.x + p.y) * p.x);
}
float terrainSurfaceFabricNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  float a = terrainSurfaceFabricHash(i);
  float b = terrainSurfaceFabricHash(i + vec2(1.0, 0.0));
  float c = terrainSurfaceFabricHash(i + vec2(0.0, 1.0));
  float d = terrainSurfaceFabricHash(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
float terrainSurfaceFabricFbm(vec2 p) {
  float sum = 0.0;
  float amp = 0.56;
  for (int i = 0; i < 5; i++) {
    sum += terrainSurfaceFabricNoise(p) * amp;
    p = p * 2.035 + vec2(19.17, -11.3);
    amp *= 0.47;
  }
  return sum / 1.0516;
}
float terrainSurfaceFabricRidge(vec2 p) {
  float n = terrainSurfaceFabricFbm(p);
  return 1.0 - abs(n * 2.0 - 1.0);
}
`;

const SHADER_FRAGMENT = `
vec2 terrainSurfaceFabricWorldXZ = vTerrainSurfaceFabricWorldPosition.xz;
float terrainSurfaceFabricRegional = terrainSurfaceFabricFbm(terrainSurfaceFabricWorldXZ / 3800.0 + vec2(5.7, -13.1));
float terrainSurfaceFabricMacro = terrainSurfaceFabricFbm(terrainSurfaceFabricWorldXZ / 1200.0 + vec2(-12.2, 8.4));
float terrainSurfaceFabricBroad = terrainSurfaceFabricFbm(terrainSurfaceFabricWorldXZ / 520.0 + vec2(9.3, 17.6));
float terrainSurfaceFabricMeso = terrainSurfaceFabricFbm(terrainSurfaceFabricWorldXZ / 210.0 + vec2(-21.5, 4.8));
float terrainSurfaceFabricFine = terrainSurfaceFabricFbm(terrainSurfaceFabricWorldXZ / 74.0 + vec2(14.2, -31.7));
float terrainSurfaceFabricGrain = terrainSurfaceFabricNoise(terrainSurfaceFabricWorldXZ / 29.0 + vec2(7.4, 22.1));
float terrainSurfaceFabricWarpA = terrainSurfaceFabricFbm(terrainSurfaceFabricWorldXZ / 1450.0 + vec2(4.5, -9.8));
float terrainSurfaceFabricWarpB = terrainSurfaceFabricFbm(terrainSurfaceFabricWorldXZ / 980.0 + vec2(-7.1, 13.8));
vec2 terrainSurfaceFabricWarped = terrainSurfaceFabricWorldXZ + (vec2(terrainSurfaceFabricWarpA, terrainSurfaceFabricWarpB) - 0.5) * 360.0;
float terrainSurfaceFabricEco = terrainSurfaceFabricFbm(terrainSurfaceFabricWarped / 690.0 + vec2(1.8, 28.9));
float terrainSurfaceFabricDrainage = terrainSurfaceFabricFbm(terrainSurfaceFabricWarped / 270.0 + vec2(-18.1, 6.7));
float terrainSurfaceFabricRidgeValue = terrainSurfaceFabricRidge(terrainSurfaceFabricWarped / 170.0 + vec2(12.4, -17.2));
float terrainSurfaceFabricHeight = vTerrainSurfaceFabricWorldPosition.y;
float terrainSurfaceFabricSlope = 1.0 - clamp(abs(vTerrainSurfaceFabricWorldNormal.y), 0.0, 1.0);
float terrainSurfaceFabricRock = smoothstep(0.22, 0.72, terrainSurfaceFabricSlope);
float terrainSurfaceFabricSnow = smoothstep(210.0, 560.0, terrainSurfaceFabricHeight) * (1.0 - smoothstep(0.16, 0.30, terrainSurfaceFabricSlope));
float terrainSurfaceFabricLowland = 1.0 - smoothstep(8.0, 120.0, terrainSurfaceFabricHeight);
float terrainSurfaceFabricWaterProximity = 1.0 - smoothstep(1.0, 20.0, terrainSurfaceFabricHeight - ${Number(6).toFixed(3)});
float terrainSurfaceFabricMoisture = clamp(
  0.48 + (0.5 - terrainSurfaceFabricRegional) * 0.34
  + (0.5 - terrainSurfaceFabricMacro) * 0.28
  + (0.5 - terrainSurfaceFabricBroad) * 0.22
  + (0.5 - terrainSurfaceFabricDrainage) * terrainSurfaceFabricLowland * 0.22
  + terrainSurfaceFabricWaterProximity * 0.18,
  0.0, 1.0
);
float terrainSurfaceFabricDetailFade = 1.0 - smoothstep(22.0, 1450.0, length(terrainSurfaceFabricWorldXZ - cameraPosition.xz));
float terrainSurfaceFabricAerialFade = smoothstep(7.0, 190.0, distance(cameraPosition.xz, terrainSurfaceFabricWorldXZ));
float terrainSurfaceFabricAntiTileA = terrainSurfaceFabricNoise(terrainSurfaceFabricWorldXZ / 43.0 + terrainSurfaceFabricWarped / 840.0);
float terrainSurfaceFabricAntiTileB = terrainSurfaceFabricNoise(terrainSurfaceFabricWorldXZ / 91.0 - terrainSurfaceFabricWarped / 610.0);
float terrainSurfaceFabricAntiTile = mix(terrainSurfaceFabricAntiTileA, terrainSurfaceFabricAntiTileB, 0.57);
float terrainSurfaceFabricValue = 0.97
  + (terrainSurfaceFabricRegional - 0.5) * 0.13
  + (terrainSurfaceFabricMacro - 0.5) * 0.11
  + (terrainSurfaceFabricBroad - 0.5) * 0.09
  + (terrainSurfaceFabricMeso - 0.5) * 0.055
  + (terrainSurfaceFabricGrain - 0.5) * 0.023;
float terrainSurfaceFabricWetDamp = terrainSurfaceFabricMoisture * (0.34 + terrainSurfaceFabricLowland * 0.30);
float terrainSurfaceFabricDryLift = (1.0 - terrainSurfaceFabricMoisture) * (0.30 + terrainSurfaceFabricRock * 0.22);
float terrainSurfaceFabricRockLift = terrainSurfaceFabricRock * (0.40 + terrainSurfaceFabricRidgeValue * 0.31);
float terrainSurfaceFabricSnowLift = terrainSurfaceFabricSnow * 0.62;
float terrainSurfaceFabricGreener = (1.0 - terrainSurfaceFabricRock) * (1.0 - terrainSurfaceFabricSnow) * terrainSurfaceFabricLowland;
float terrainSurfaceFabricMosaic = (terrainSurfaceFabricEco - 0.5) * 0.24 + (terrainSurfaceFabricDrainage - 0.5) * 0.16 + (terrainSurfaceFabricAntiTile - 0.5) * 0.16;
diffuseColor.rgb *= terrainSurfaceFabricValue;
diffuseColor.rgb *= mix(1.0, 0.86, terrainSurfaceFabricWetDamp * 0.19);
diffuseColor.rgb *= mix(1.0, 1.10, terrainSurfaceFabricDryLift * 0.12);
diffuseColor.rgb *= mix(1.0, 1.055, terrainSurfaceFabricRockLift * 0.13);
diffuseColor.rgb *= mix(1.0, 1.055, terrainSurfaceFabricSnowLift * 0.12);
diffuseColor.rgb *= 1.0 + terrainSurfaceFabricMosaic * 0.11;
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.070, 0.094, 0.052), terrainSurfaceFabricGreener * 0.13);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.218, 0.194, 0.148), terrainSurfaceFabricDryLift * 0.13);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.255, 0.252, 0.236), terrainSurfaceFabricRockLift * 0.105);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.748, 0.782, 0.795), terrainSurfaceFabricSnowLift * 0.11);
diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.112, 0.122, 0.112), terrainSurfaceFabricWaterProximity * 0.075);
diffuseColor.rgb = clamp(diffuseColor.rgb, vec3(0.012), vec3(0.92));
`;

export function applyTerrainSurfaceFabric(material) {
  if (!material?.isMeshStandardMaterial) throw new TypeError('terrain surface fabric requires MeshStandardMaterial');
  const previousOnBeforeCompile = material.onBeforeCompile.bind(material);
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vTerrainSurfaceFabricWorldPosition;\nvarying vec3 vTerrainSurfaceFabricWorldNormal;')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvTerrainSurfaceFabricWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTerrainSurfaceFabricWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vTerrainSurfaceFabricWorldPosition;\nvarying vec3 vTerrainSurfaceFabricWorldNormal;\n${SHADER_COMMON}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${SHADER_FRAGMENT}`)
      .replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>
float terrainSurfaceFabricRoughNoise = terrainSurfaceFabricFbm(vTerrainSurfaceFabricWorldPosition.xz / 58.0 + vec2(21.3, -11.4));
float terrainSurfaceFabricRoughSlope = 1.0 - clamp(abs(vTerrainSurfaceFabricWorldNormal.y), 0.0, 1.0);
float terrainSurfaceFabricRoughWet = terrainSurfaceFabricMoisture;
roughnessFactor = clamp(roughnessFactor + (terrainSurfaceFabricRoughNoise - 0.5) * 0.16 + terrainSurfaceFabricRoughSlope * 0.07 - terrainSurfaceFabricRoughWet * 0.08, 0.48, 1.0);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
vec2 terrainSurfaceFabricNormalP = vTerrainSurfaceFabricWorldPosition.xz / 48.0;
float terrainSurfaceFabricNormalA = terrainSurfaceFabricNoise(terrainSurfaceFabricNormalP + vec2(0.19, 0.0));
float terrainSurfaceFabricNormalB = terrainSurfaceFabricNoise(terrainSurfaceFabricNormalP - vec2(0.19, 0.0));
float terrainSurfaceFabricNormalC = terrainSurfaceFabricNoise(terrainSurfaceFabricNormalP + vec2(0.0, 0.19));
float terrainSurfaceFabricNormalD = terrainSurfaceFabricNoise(terrainSurfaceFabricNormalP - vec2(0.0, 0.19));
vec2 terrainSurfaceFabricNormalDelta = vec2(terrainSurfaceFabricNormalA - terrainSurfaceFabricNormalB, terrainSurfaceFabricNormalC - terrainSurfaceFabricNormalD);
float terrainSurfaceFabricNormalStrength = mix(0.035, 0.115, smoothstep(0.15, 0.72, 1.0 - abs(vTerrainSurfaceFabricWorldNormal.y))) * (0.72 + terrainSurfaceFabricDetailFade * 0.28);
normal = normalize(normal + mat3(viewMatrix) * vec3(-terrainSurfaceFabricNormalDelta.x, 0.0, -terrainSurfaceFabricNormalDelta.y) * terrainSurfaceFabricNormalStrength);`);
  };
  material.customProgramCacheKey = () => TERRAIN_SURFACE_FABRIC_POLICY.shaderKey;
  material.userData = {
    ...material.userData,
    terrainSurfaceFabric: Object.freeze({
      policyId: TERRAIN_SURFACE_FABRIC_POLICY.id,
      shaderKey: TERRAIN_SURFACE_FABRIC_POLICY.shaderKey,
      worldSpace: true,
      periodicTextureSupplemental: true,
      macroScalesMeters: [...TERRAIN_SURFACE_FABRIC_POLICY.worldSpaceScalesMeters],
      canonicalHeightUnchanged: true,
      canonicalHydrologyUnchanged: true,
      canonicalColliderUnchanged: true,
    }),
  };
  material.needsUpdate = true;
  return material;
}

export function validateTerrainSurfaceFabricPolicy() {
  const P = TERRAIN_SURFACE_FABRIC_POLICY;
  const errors = [];
  if (!P.renderOnly) errors.push('not-render-only');
  if (!P.canonicalHeightUnchanged) errors.push('height-authority-changed');
  if (!P.canonicalHydrologyUnchanged) errors.push('hydrology-authority-changed');
  if (!P.canonicalColliderUnchanged) errors.push('collider-authority-changed');
  if (!P.periodicDetailTextureIsSupplemental) errors.push('periodic-detail-not-supplemental');
  if (P.worldSpaceScalesMeters.length < 5) errors.push('insufficient-world-space-scales');
  if (P.worldSpaceScalesMeters.some((value, index) => index > 0 && value <= P.worldSpaceScalesMeters[index - 1])) errors.push('non-monotonic-world-scales');
  if (P.normalVariance <= 0 || P.roughnessVariance <= 0) errors.push('flat-pbr-response');
  return Object.freeze({ ok: errors.length === 0, errors, policyId: P.id });
}
