/**
 * Deterministic, render-only surface reality response for authored and generated world assets.
 *
 * This module deliberately sits below geography/placement authority. It does not create or move
 * geometry, alter map.png-derived height, water, roads, settlements or colliders. It computes a
 * physically legible material response which the existing shared world-material fabric can consume:
 * macro weathering, meso staining, fine aggregate, moisture, salt, frost, dust, lichen, oxidation,
 * directional grain/strata and climate-aware roughness/normal response.
 *
 * The important distinction from a second material framework is that this file never replaces the
 * Shared Material Core. It only enriches the already-selected material with deterministic response
 * metadata and bounded scalar adjustments. The existing worldMaterialSurfaceFabric.js remains the
 * shader authority for world-space albedo/normal/roughness variation.
 * @module materials/worldAssetSurfaceReality
 */

import { hashString } from './textureCore.js';

export const WORLD_ASSET_SURFACE_REALITY_POLICY = Object.freeze({
  id: 'world-asset-surface-reality-2026-09-14-v1',
  revision: 'v1-hydrology-climate-weathering',
  renderOnly: true,
  deterministic: true,
  geometryUnchanged: true,
  placementUnchanged: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalRoadsUnchanged: true,
  canonicalSettlementsUnchanged: true,
  sourceMapsPreserved: true,
  sharedMaterialCoreRequired: true,
  sharedWorldFabricConsumer: 'worldMaterialSurfaceFabric',
  worldSpace: true,
  multiscale: true,
  macroWeathering: true,
  mesoWeathering: true,
  fineAggregate: true,
  hydrologyAware: true,
  climateAware: true,
  slopeAware: true,
  exposureAware: true,
  frostAware: true,
  saltAware: true,
  oxidationAware: true,
  lichenAware: true,
  dustAware: true,
  edgeWearAware: true,
  directionalFabric: true,
  independentRoughnessDomain: true,
  independentNormalDomain: true,
  profileIds: Object.freeze([
    'stone', 'wood', 'plaster', 'metal', 'cloth', 'vegetation', 'soil', 'snow', 'generic',
  ]),
  climateIds: Object.freeze([
    'temperate', 'coastal', 'wetland', 'arid', 'semiarid', 'alpine', 'tundra', 'glacial',
    'volcanic', 'maritime-cold',
  ]),
});

const clamp01 = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : fallback;
};

const clamp = (value, minimum, maximum, fallback = minimum) => {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(minimum, Math.min(maximum, number)) : fallback;
};

const lerp = (a, b, t) => a + (b - a) * t;

const smoothstep = (edge0, edge1, value) => {
  if (edge0 === edge1) return value >= edge1 ? 1 : 0;
  const t = clamp01((Number(value) - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
};

const invSmoothstep = (edge0, edge1, value) => 1 - smoothstep(edge0, edge1, value);

function mixArray(a, b, t) {
  return a.map((value, index) => lerp(value, b[index] ?? value, t));
}

function finitePositive(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function stableSeed(value, salt = '') {
  return hashString(`${String(value ?? 'asset')}|${salt}`) >>> 0;
}

function hash01(value) {
  let x = Number(value) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function hash2D(x, z, seed = 0) {
  const ix = Math.floor(Number(x) || 0);
  const iz = Math.floor(Number(z) || 0);
  const a = Math.imul(ix ^ (seed >>> 0), 0x27d4eb2d);
  const b = Math.imul(iz + (seed >>> 0), 0x165667b1);
  return hash01((a ^ b) >>> 0);
}

function valueNoise2D(x, z, scale, seed = 0) {
  const safeScale = Math.max(0.25, finitePositive(scale, 1));
  const px = Number(x) / safeScale;
  const pz = Number(z) / safeScale;
  const x0 = Math.floor(px);
  const z0 = Math.floor(pz);
  const fx = px - x0;
  const fz = pz - z0;
  const sx = fx * fx * (3 - 2 * fx);
  const sz = fz * fz * (3 - 2 * fz);
  const a = hash2D(x0, z0, seed);
  const b = hash2D(x0 + 1, z0, seed);
  const c = hash2D(x0, z0 + 1, seed);
  const d = hash2D(x0 + 1, z0 + 1, seed);
  return lerp(lerp(a, b, sx), lerp(c, d, sx), sz);
}

function ridgedNoise2D(x, z, scale, seed = 0) {
  return 1 - Math.abs(valueNoise2D(x, z, scale, seed) * 2 - 1);
}

function signedNoise2D(x, z, scale, seed = 0) {
  return valueNoise2D(x, z, scale, seed) * 2 - 1;
}

function fbm2D(x, z, scale, seed = 0, octaves = 4, lacunarity = 2.03, gain = 0.48) {
  const baseScale = Math.max(0.25, finitePositive(scale, 1));
  let amplitude = 0.5;
  let frequency = 1;
  let total = 0;
  let normalizer = 0;
  for (let octave = 0; octave < octaves; octave += 1) {
    total += valueNoise2D(x * frequency, z * frequency, baseScale, seed + octave * 97) * amplitude;
    normalizer += amplitude;
    amplitude *= gain;
    frequency *= lacunarity;
  }
  return normalizer > 0 ? total / normalizer : 0.5;
}

function directionalNoise2D(x, z, scale, angleRadians, seed = 0) {
  const c = Math.cos(angleRadians);
  const s = Math.sin(angleRadians);
  const along = x * c + z * s;
  const across = -x * s + z * c;
  return fbm2D(along, across, scale, seed, 4, 2.01, 0.52);
}

function band(value, center, width) {
  return Math.exp(-((value - center) * (value - center)) / Math.max(1e-5, width * width));
}

function normalizeString(value) {
  return String(value ?? '').trim().toLowerCase();
}

const PROFILE_LIBRARY = Object.freeze({
  stone: Object.freeze({
    albedoGain: 0.13,
    normalGain: 0.12,
    roughnessBase: 0.86,
    roughnessGain: 0.16,
    stainGain: 0.15,
    dampGain: 0.17,
    saltGain: 0.11,
    frostGain: 0.09,
    dustGain: 0.08,
    oxidationGain: 0.035,
    lichenGain: 0.075,
    edgeWearGain: 0.10,
    macroMeters: 94,
    mesoMeters: 17,
    fineMeters: 2.6,
    directionalMeters: 42,
    directionalStrength: 0.10,
    poreStrength: 0.08,
  }),
  wood: Object.freeze({
    albedoGain: 0.10,
    normalGain: 0.09,
    roughnessBase: 0.80,
    roughnessGain: 0.13,
    stainGain: 0.18,
    dampGain: 0.16,
    saltGain: 0.05,
    frostGain: 0.06,
    dustGain: 0.06,
    oxidationGain: 0.018,
    lichenGain: 0.05,
    edgeWearGain: 0.14,
    macroMeters: 48,
    mesoMeters: 10,
    fineMeters: 0.92,
    directionalMeters: 17,
    directionalStrength: 0.16,
    poreStrength: 0.06,
  }),
  plaster: Object.freeze({
    albedoGain: 0.095,
    normalGain: 0.05,
    roughnessBase: 0.84,
    roughnessGain: 0.11,
    stainGain: 0.22,
    dampGain: 0.19,
    saltGain: 0.14,
    frostGain: 0.06,
    dustGain: 0.08,
    oxidationGain: 0.012,
    lichenGain: 0.04,
    edgeWearGain: 0.13,
    macroMeters: 74,
    mesoMeters: 14,
    fineMeters: 1.9,
    directionalMeters: 31,
    directionalStrength: 0.07,
    poreStrength: 0.09,
  }),
  metal: Object.freeze({
    albedoGain: 0.07,
    normalGain: 0.045,
    roughnessBase: 0.48,
    roughnessGain: 0.21,
    stainGain: 0.12,
    dampGain: 0.09,
    saltGain: 0.08,
    frostGain: 0.04,
    dustGain: 0.05,
    oxidationGain: 0.24,
    lichenGain: 0.008,
    edgeWearGain: 0.20,
    macroMeters: 41,
    mesoMeters: 8,
    fineMeters: 0.84,
    directionalMeters: 12,
    directionalStrength: 0.13,
    poreStrength: 0.04,
  }),
  cloth: Object.freeze({
    albedoGain: 0.075,
    normalGain: 0.038,
    roughnessBase: 0.90,
    roughnessGain: 0.08,
    stainGain: 0.14,
    dampGain: 0.11,
    saltGain: 0.05,
    frostGain: 0.035,
    dustGain: 0.10,
    oxidationGain: 0,
    lichenGain: 0,
    edgeWearGain: 0.12,
    macroMeters: 36,
    mesoMeters: 7,
    fineMeters: 0.62,
    directionalMeters: 5.8,
    directionalStrength: 0.20,
    poreStrength: 0.03,
  }),
  vegetation: Object.freeze({
    albedoGain: 0.11,
    normalGain: 0.065,
    roughnessBase: 0.82,
    roughnessGain: 0.12,
    stainGain: 0.05,
    dampGain: 0.14,
    saltGain: 0.018,
    frostGain: 0.13,
    dustGain: 0.045,
    oxidationGain: 0,
    lichenGain: 0.022,
    edgeWearGain: 0.09,
    macroMeters: 34,
    mesoMeters: 8.4,
    fineMeters: 1.05,
    directionalMeters: 18,
    directionalStrength: 0.09,
    poreStrength: 0.025,
  }),
  soil: Object.freeze({
    albedoGain: 0.14,
    normalGain: 0.105,
    roughnessBase: 0.92,
    roughnessGain: 0.12,
    stainGain: 0.12,
    dampGain: 0.22,
    saltGain: 0.09,
    frostGain: 0.08,
    dustGain: 0.11,
    oxidationGain: 0.01,
    lichenGain: 0.03,
    edgeWearGain: 0.07,
    macroMeters: 74,
    mesoMeters: 16,
    fineMeters: 2.25,
    directionalMeters: 29,
    directionalStrength: 0.10,
    poreStrength: 0.11,
  }),
  snow: Object.freeze({
    albedoGain: 0.08,
    normalGain: 0.06,
    roughnessBase: 0.81,
    roughnessGain: 0.13,
    stainGain: 0.08,
    dampGain: 0.06,
    saltGain: 0.018,
    frostGain: 0.20,
    dustGain: 0.028,
    oxidationGain: 0,
    lichenGain: 0,
    edgeWearGain: 0.045,
    macroMeters: 96,
    mesoMeters: 19,
    fineMeters: 2.1,
    directionalMeters: 52,
    directionalStrength: 0.18,
    poreStrength: 0.055,
  }),
  generic: Object.freeze({
    albedoGain: 0.085,
    normalGain: 0.055,
    roughnessBase: 0.84,
    roughnessGain: 0.11,
    stainGain: 0.10,
    dampGain: 0.12,
    saltGain: 0.06,
    frostGain: 0.055,
    dustGain: 0.07,
    oxidationGain: 0.018,
    lichenGain: 0.018,
    edgeWearGain: 0.09,
    macroMeters: 78,
    mesoMeters: 15,
    fineMeters: 2.0,
    directionalMeters: 33,
    directionalStrength: 0.08,
    poreStrength: 0.06,
  }),
});

const CLIMATE_LIBRARY = Object.freeze({
  temperate: Object.freeze({
    moisture: 0.54,
    aridity: 0.34,
    frost: 0.08,
    exposure: 0.48,
    shelter: 0.52,
    vegetation: 0.64,
    dust: 0.25,
    salt: 0.08,
    moss: 0.34,
    lichen: 0.20,
    snowPersistence: 0.12,
    weathering: 0.48,
  }),
  coastal: Object.freeze({
    moisture: 0.68,
    aridity: 0.25,
    frost: 0.09,
    exposure: 0.64,
    shelter: 0.36,
    vegetation: 0.58,
    dust: 0.14,
    salt: 0.58,
    moss: 0.40,
    lichen: 0.26,
    snowPersistence: 0.16,
    weathering: 0.62,
  }),
  wetland: Object.freeze({
    moisture: 0.86,
    aridity: 0.10,
    frost: 0.08,
    exposure: 0.33,
    shelter: 0.67,
    vegetation: 0.88,
    dust: 0.06,
    salt: 0.15,
    moss: 0.72,
    lichen: 0.33,
    snowPersistence: 0.11,
    weathering: 0.69,
  }),
  arid: Object.freeze({
    moisture: 0.20,
    aridity: 0.84,
    frost: 0.04,
    exposure: 0.76,
    shelter: 0.24,
    vegetation: 0.18,
    dust: 0.76,
    salt: 0.36,
    moss: 0.05,
    lichen: 0.03,
    snowPersistence: 0.015,
    weathering: 0.56,
  }),
  semiarid: Object.freeze({
    moisture: 0.34,
    aridity: 0.63,
    frost: 0.05,
    exposure: 0.67,
    shelter: 0.33,
    vegetation: 0.34,
    dust: 0.58,
    salt: 0.28,
    moss: 0.08,
    lichen: 0.06,
    snowPersistence: 0.02,
    weathering: 0.50,
  }),
  alpine: Object.freeze({
    moisture: 0.57,
    aridity: 0.27,
    frost: 0.69,
    exposure: 0.73,
    shelter: 0.27,
    vegetation: 0.31,
    dust: 0.18,
    salt: 0.04,
    moss: 0.21,
    lichen: 0.31,
    snowPersistence: 0.58,
    weathering: 0.76,
  }),
  tundra: Object.freeze({
    moisture: 0.63,
    aridity: 0.20,
    frost: 0.83,
    exposure: 0.66,
    shelter: 0.34,
    vegetation: 0.26,
    dust: 0.10,
    salt: 0.06,
    moss: 0.44,
    lichen: 0.47,
    snowPersistence: 0.78,
    weathering: 0.81,
  }),
  glacial: Object.freeze({
    moisture: 0.72,
    aridity: 0.16,
    frost: 0.97,
    exposure: 0.78,
    shelter: 0.22,
    vegetation: 0.03,
    dust: 0.055,
    salt: 0.025,
    moss: 0.01,
    lichen: 0.015,
    snowPersistence: 0.96,
    weathering: 0.70,
  }),
  volcanic: Object.freeze({
    moisture: 0.43,
    aridity: 0.43,
    frost: 0.04,
    exposure: 0.77,
    shelter: 0.23,
    vegetation: 0.12,
    dust: 0.31,
    salt: 0.09,
    moss: 0.03,
    lichen: 0.02,
    snowPersistence: 0.02,
    weathering: 0.89,
  }),
  'maritime-cold': Object.freeze({
    moisture: 0.74,
    aridity: 0.18,
    frost: 0.55,
    exposure: 0.69,
    shelter: 0.31,
    vegetation: 0.42,
    dust: 0.08,
    salt: 0.45,
    moss: 0.52,
    lichen: 0.39,
    snowPersistence: 0.46,
    weathering: 0.73,
  }),
});

const ROLE_PATTERNS = Object.freeze([
  ['snow', /snow|ice|glacier|frost|firn|sleet/],
  ['vegetation', /tree|pine|leaf|foliage|grass|moss|shrub|vine|plant|fern/],
  ['wood', /wood|timber|bark|plank|beam|log|oak|pinewood|door|gate|cart|barrel/],
  ['metal', /steel|iron|bronze|copper|brass|metal|chain|blade|armor|armour|hinge|tool/],
  ['cloth', /cloth|fabric|linen|wool|banner|flag|cape|tent|leather|hide/],
  ['plaster', /plaster|stucco|lime|mortar|adobe|painted|render/],
  ['soil', /soil|earth|dirt|mud|sand|field|farm|path|road|track|trail/],
  ['stone', /stone|rock|granite|basalt|brick|masonry|castle|keep|tower|wall|ruin|cliff/],
]);

const CLIMATE_HINTS = Object.freeze([
  ['glacial', /glacial|ice-sheet|permanent-ice|frozen|polar/],
  ['tundra', /tundra|subarctic|treeline|snow-pine|winter/],
  ['alpine', /alpine|mountain|highland|ridge|summit|cirque/],
  ['volcanic', /valyria|volcanic|lava|basalt|obsidian|ash|pumice|sulfur/],
  ['wetland', /wetland|marsh|swamp|reed|bog|fen/],
  ['coastal', /coast|shore|sea|beach|intertidal|cliff-coast/],
  ['arid', /desert|arid|dune|dryland|badland/],
  ['semiarid', /steppe|dry-grass|savanna|semi-arid/],
]);

const SURFACE_ROLE_BIASES = Object.freeze({
  stone: Object.freeze({ runoff: 0.12, shelter: -0.03, exposedEdge: 0.10, cold: 0.04, dust: 0.02 }),
  wood: Object.freeze({ runoff: 0.03, shelter: 0.08, exposedEdge: 0.06, cold: 0.02, dust: 0.01 }),
  plaster: Object.freeze({ runoff: 0.18, shelter: -0.02, exposedEdge: 0.12, cold: 0.01, dust: 0.03 }),
  metal: Object.freeze({ runoff: 0.09, shelter: 0.02, exposedEdge: 0.16, cold: 0.02, dust: 0.04 }),
  cloth: Object.freeze({ runoff: 0.04, shelter: 0.10, exposedEdge: 0.08, cold: 0.02, dust: 0.03 }),
  vegetation: Object.freeze({ runoff: 0.00, shelter: 0.15, exposedEdge: 0.05, cold: 0.12, dust: 0.00 }),
  soil: Object.freeze({ runoff: 0.22, shelter: 0.06, exposedEdge: 0.07, cold: 0.05, dust: 0.08 }),
  snow: Object.freeze({ runoff: 0.09, shelter: 0.02, exposedEdge: 0.03, cold: 0.18, dust: 0.00 }),
  generic: Object.freeze({ runoff: 0.06, shelter: 0.04, exposedEdge: 0.05, cold: 0.03, dust: 0.02 }),
});

function materialSignature({ paletteId = '', subject = {}, mesh = null, material = null, object = null } = {}) {
  return [
    paletteId,
    subject?.id,
    subject?.name,
    subject?.category,
    subject?.src,
    object?.name,
    mesh?.name,
    material?.name,
    material?.userData?.paletteId,
  ].filter(Boolean).map(normalizeString).join('|');
}

export function inferSurfaceRealityMaterialProfile(context = {}) {
  const signature = materialSignature(context);
  for (const [profile, pattern] of ROLE_PATTERNS) {
    if (pattern.test(signature)) return profile;
  }
  return 'generic';
}

export function inferSurfaceRealityClimate(context = {}) {
  const signature = [
    context?.climateId,
    context?.subject?.category,
    context?.subject?.name,
    context?.subject?.src,
    context?.object?.name,
    context?.material?.name,
  ].filter(Boolean).map(normalizeString).join('|');
  for (const [climate, pattern] of CLIMATE_HINTS) {
    if (pattern.test(signature)) return climate;
  }
  return 'temperate';
}

export function sanitizeSurfaceRealityContext(context = {}) {
  const climateId = CLIMATE_LIBRARY[context.climateId] ? context.climateId : inferSurfaceRealityClimate(context);
  const profileId = PROFILE_LIBRARY[context.profileId] ? context.profileId : inferSurfaceRealityMaterialProfile(context);
  const climate = CLIMATE_LIBRARY[climateId];
  const profile = PROFILE_LIBRARY[profileId];
  return Object.freeze({
    seed: stableSeed(context.seed ?? context.variant ?? context.subject?.id ?? context.object?.name ?? 'asset', 'surface-reality'),
    worldX: Number.isFinite(Number(context.worldX)) ? Number(context.worldX) : 0,
    worldZ: Number.isFinite(Number(context.worldZ)) ? Number(context.worldZ) : 0,
    height: Number.isFinite(Number(context.height)) ? Number(context.height) : 0,
    normalizedX: clamp01(context.normalizedX, 0.5),
    normalizedZ: clamp01(context.normalizedZ, 0.5),
    slope: clamp01(context.slope, 0.25),
    exposure: clamp01(context.exposure, climate.exposure),
    shelter: clamp01(context.shelter, climate.shelter),
    moisture: clamp01(context.moisture, climate.moisture),
    aridity: clamp01(context.aridity, climate.aridity),
    erosion: clamp01(context.erosion, climate.weathering),
    weathering: clamp01(context.weathering, climate.weathering),
    frost: clamp01(context.frost, climate.frost),
    snow: clamp01(context.snow, climate.snowPersistence),
    vegetation: clamp01(context.vegetation, climate.vegetation),
    dust: clamp01(context.dust, climate.dust),
    salt: clamp01(context.salt, climate.salt),
    moss: clamp01(context.moss, climate.moss),
    lichen: clamp01(context.lichen, climate.lichen),
    waterProximity: clamp01(context.waterProximity, climate.moisture),
    waterDepth: clamp01(context.waterDepth, 0),
    riverProximity: clamp01(context.riverProximity, 0),
    wetEdge: clamp01(context.wetEdge, 0),
    sediment: clamp01(context.sediment, 0),
    spray: clamp01(context.spray, 0),
    snowPersistence: clamp01(context.snowPersistence, climate.snowPersistence),
    climateId,
    profileId,
    profile,
    climate,
  });
}

function sampleRealityFields(ctx) {
  const P = ctx.profile;
  const seed = ctx.seed;
  const x = ctx.worldX;
  const z = ctx.worldZ;
  const directionalAngle = (hash01(seed ^ 0x9e3779b9) - 0.5) * Math.PI;
  const macro = fbm2D(x + 11.3, z - 7.1, P.macroMeters, seed ^ 0x51a7c9, 4, 2.02, 0.52);
  const meso = fbm2D(x - 17.4, z + 12.6, P.mesoMeters, seed ^ 0x72de11, 5, 2.07, 0.47);
  const fine = fbm2D(x + 3.7, z - 29.2, P.fineMeters, seed ^ 0xa8143f, 4, 2.01, 0.44);
  const grain = directionalNoise2D(x, z, P.directionalMeters, directionalAngle, seed ^ 0x44b321);
  const pore = ridgedNoise2D(x - 19.1, z + 4.8, P.fineMeters * 1.75, seed ^ 0x73aa17);
  const stain = fbm2D(x + 40.2, z - 13.4, P.mesoMeters * 1.65, seed ^ 0x63e251, 3, 2.18, 0.51);
  const streak = directionalNoise2D(x + 6, z - 3, P.directionalMeters * 0.68, directionalAngle + Math.PI / 2, seed ^ 0x9021ef);
  const edgeWear = ridgedNoise2D(x / 1.1, z / 1.1, P.fineMeters * 4.2, seed ^ 0x812341);
  const dustDomain = fbm2D(x - 8.2, z + 25.3, P.macroMeters * 0.74, seed ^ 0x31af01, 3, 2.03, 0.52);
  const coldDomain = fbm2D(x + 12.1, z - 8.3, P.macroMeters * 1.18, seed ^ 0x77a1d2, 4, 2.05, 0.50);
  return Object.freeze({
    directionalAngle,
    macro,
    meso,
    fine,
    grain,
    pore,
    stain,
    streak,
    edgeWear,
    dustDomain,
    coldDomain,
  });
}

function environmentalResponse(ctx, fields) {
  const roleBias = SURFACE_ROLE_BIASES[ctx.profileId] ?? SURFACE_ROLE_BIASES.generic;
  const slope = ctx.slope;
  const exposure = clamp01(ctx.exposure + roleBias.exposedEdge * slope);
  const sheltered = clamp01(ctx.shelter + (1 - slope) * roleBias.shelter);
  const runoff = clamp01(ctx.waterProximity * 0.56 + ctx.wetEdge * 0.72 + ctx.riverProximity * 0.42 + roleBias.runoff * slope);
  const persistentSnow = clamp01(ctx.snowPersistence * 0.56 + ctx.snow * 0.44 + ctx.frost * 0.22);
  const coldPocket = clamp01(ctx.frost * 0.62 + fields.coldDomain * 0.38);
  const dust = clamp01(ctx.dust + roleBias.dust * (1 - runoff) + (1 - ctx.moisture) * 0.12);
  const salt = clamp01(ctx.salt + ctx.spray * 0.62 + ctx.wetEdge * 0.18);
  const moss = clamp01(ctx.moss + ctx.moisture * 0.23 + runoff * 0.18 - exposure * 0.12);
  const lichen = clamp01(ctx.lichen + (1 - ctx.vegetation) * 0.08 + ctx.frost * 0.13 + exposure * 0.05);
  const stain = clamp01(ctx.weathering * Pct(ctx.profile.stainGain, 0.1) + runoff * 0.35 + fields.stain * 0.32);
  const abrasion = clamp01(exposure * ctx.weathering * 0.54 + ctx.erosion * 0.28 + fields.edgeWear * 0.18);
  const sediment = clamp01(ctx.sediment + runoff * 0.32 + (1 - exposure) * 0.08);
  const oxidation = clamp01((ctx.profile.oxidationGain * 2.0) + salt * 0.22 + runoff * 0.12);
  return Object.freeze({ exposure, sheltered, runoff, persistentSnow, coldPocket, dust, salt, moss, lichen, stain, abrasion, sediment, oxidation });
}

function Pct(value, fallback = 0) {
  return clamp01(Number.isFinite(Number(value)) ? Number(value) : fallback);
}

function deriveFabricResponse(ctx, fields, environment) {
  const P = ctx.profile;
  const moisture = clamp01(ctx.moisture * 0.48 + environment.runoff * 0.38 + ctx.waterProximity * 0.14);
  const snow = clamp01(environment.persistentSnow * 0.74 + environment.coldPocket * 0.26);
  const albedo = clamp(-P.albedoGain * 0.82
    + (fields.macro - 0.5) * P.albedoGain
    + (fields.meso - 0.5) * P.albedoGain * 0.72
    + (fields.fine - 0.5) * P.albedoGain * 0.28
    - environment.stain * 0.08
    - environment.salt * 0.03
    + environment.dust * P.dustGain * 0.24,
    -0.26, 0.26, 0);
  const roughness = clamp(
    P.roughnessBase
      + (fields.macro - 0.5) * P.roughnessGain
      + (fields.pore - 0.5) * P.poreStrength
      + environment.salt * P.saltGain * 0.34
      + environment.dust * P.dustGain * 0.28
      + environment.abrasion * P.edgeWearGain * 0.18
      - moisture * P.dampGain * 0.12,
    0.18, 1.0, P.roughnessBase,
  );
  const normal = clamp(
    P.normalGain
      * (0.74 + fields.meso * 0.26)
      + environment.abrasion * 0.028
      + fields.pore * 0.022,
    0.015, 0.30, P.normalGain,
  );
  const strata = clamp01(
    fields.grain * 0.58
      + fields.streak * 0.23
      + (1 - environment.sheltered) * 0.11
      + ctx.lithic * 0.08,
  );
  const grain = clamp01(
    fields.pore * 0.48
      + fields.fine * 0.31
      + fields.grain * 0.21,
  );
  const streak = clamp01(fields.streak * 0.66 + environment.runoff * 0.21 + environment.salt * 0.13);
  return Object.freeze({
    albedo,
    roughness,
    normal,
    strata,
    grain,
    streak,
    moisture,
    snow,
    dust: environment.dust,
    salt: environment.salt,
    moss: environment.moss,
    lichen: environment.lichen,
    oxidation: environment.oxidation,
    sediment: environment.sediment,
    crust: snow * (ctx.profileId === 'snow' ? 0.92 : 0.32),
    canopyMottle: ctx.profileId === 'vegetation' ? clamp01(fields.meso * 0.64 + fields.fine * 0.36) : 0,
    chlorophyllVariation: ctx.profileId === 'vegetation' ? clamp01(0.35 + fields.macro * 0.45 + ctx.moisture * 0.20) : 0,
    windSastrugi: ctx.profileId === 'snow' ? clamp01(fields.streak * 0.74 + environment.exposure * 0.26) : clamp01(environment.exposure * ctx.frost * 0.12),
  });
}

function buildRealityDiagnostics(ctx, fields, environment, fabric) {
  const values = [
    fields.macro,
    fields.meso,
    fields.fine,
    fields.grain,
    fields.pore,
    fields.stain,
    fields.streak,
    environment.exposure,
    environment.sheltered,
    environment.runoff,
    environment.persistentSnow,
    environment.coldPocket,
    environment.dust,
    environment.salt,
    environment.moss,
    environment.lichen,
    environment.stain,
    environment.abrasion,
    environment.sediment,
    environment.oxidation,
    fabric.albedo,
    fabric.roughness,
    fabric.normal,
  ];
  return Object.freeze({
    finite: values.every(Number.isFinite),
    minField: Math.min(...values),
    maxField: Math.max(...values),
    multiscale: {
      macro: fields.macro,
      meso: fields.meso,
      fine: fields.fine,
    },
    environmental: {
      runoff: environment.runoff,
      salt: environment.salt,
      frost: environment.coldPocket,
      dust: environment.dust,
      moss: environment.moss,
      lichen: environment.lichen,
    },
  });
}

export function resolveWorldAssetSurfaceReality(context = {}) {
  const ctx = sanitizeSurfaceRealityContext(context);
  const fields = sampleRealityFields(ctx);
  const environment = environmentalResponse(ctx, fields);
  const fabric = deriveFabricResponse(ctx, fields, environment);
  const diagnostics = buildRealityDiagnostics(ctx, fields, environment, fabric);
  if (!diagnostics.finite) throw new Error('world asset surface reality produced non-finite response');
  return Object.freeze({
    policyId: WORLD_ASSET_SURFACE_REALITY_POLICY.id,
    revision: WORLD_ASSET_SURFACE_REALITY_POLICY.revision,
    profileId: ctx.profileId,
    climateId: ctx.climateId,
    seed: ctx.seed,
    world: Object.freeze({ x: ctx.worldX, z: ctx.worldZ, height: ctx.height }),
    context: Object.freeze({
      slope: ctx.slope,
      moisture: ctx.moisture,
      exposure: ctx.exposure,
      shelter: ctx.shelter,
      snow: ctx.snow,
      frost: ctx.frost,
      salt: ctx.salt,
      dust: ctx.dust,
      vegetation: ctx.vegetation,
      waterProximity: ctx.waterProximity,
      waterDepth: ctx.waterDepth,
      riverProximity: ctx.riverProximity,
      wetEdge: ctx.wetEdge,
      sediment: ctx.sediment,
      spray: ctx.spray,
      climateId: ctx.climateId,
    }),
    fabric,
    environment,
    fields: Object.freeze({
      macro: fields.macro,
      meso: fields.meso,
      fine: fields.fine,
      grain: fields.grain,
      pore: fields.pore,
      stain: fields.stain,
      streak: fields.streak,
      edgeWear: fields.edgeWear,
      dustDomain: fields.dustDomain,
      coldDomain: fields.coldDomain,
      directionalAngle: fields.directionalAngle,
    }),
    diagnostics,
  });
}

function cloneMaterialIfNeeded(material) {
  if (!material?.isMaterial) return material;
  const clone = material.clone();
  clone.userData = { ...(material.userData || {}) };
  if (material.onBeforeCompile) clone.onBeforeCompile = material.onBeforeCompile;
  if (material.customProgramCacheKey) clone.customProgramCacheKey = material.customProgramCacheKey;
  return clone;
}

function updateWorldAssetSurfaceResponse(material, reality) {
  material.userData ||= {};
  const existing = material.userData.worldAssetSurfaceResponse || {};
  const existingFabric = existing.fabric || {};
  material.userData.worldAssetSurfaceResponse = Object.freeze({
    ...existing,
    version: 2,
    policyId: WORLD_ASSET_SURFACE_REALITY_POLICY.id,
    profileId: reality.profileId,
    climateId: reality.climateId,
    reality,
    environment: Object.freeze({
      ...(existing.environment || {}),
      moss: reality.environment.moss,
      lichen: reality.environment.lichen,
      oxidation: reality.environment.oxidation,
      salt: reality.environment.salt,
      sediment: reality.environment.sediment,
      dust: reality.environment.dust,
      snow: reality.fabric.snow,
      frost: reality.context.frost,
      wetEdge: reality.context.wetEdge,
      spray: reality.context.spray,
    }),
    fabric: Object.freeze({
      ...existingFabric,
      macroMeters: reality.profileId === 'wood' ? 46 : reality.profileId === 'metal' ? 40 : reality.fabric ? reality.fields.macro > 0.5 ? 82 : 94 : 82,
      mesoMeters: reality.profileId === 'vegetation' ? 8.5 : reality.profileId === 'snow' ? 19 : 16,
      fineMeters: reality.profileId === 'metal' ? 0.82 : reality.profileId === 'wood' ? 0.92 : 2.1,
      strataStrength: Math.max(Number(existingFabric.strataStrength) || 0, reality.fabric.strata),
      grainStrength: Math.max(Number(existingFabric.grainStrength) || 0, reality.fabric.grain),
      sedimentStrength: Math.max(Number(existingFabric.sedimentStrength) || 0, reality.fabric.sediment),
      streakStrength: Math.max(Number(existingFabric.streakStrength) || 0, reality.fabric.streak),
      crustStrength: Math.max(Number(existingFabric.crustStrength) || 0, reality.fabric.crust),
      windSastrugi: Math.max(Number(existingFabric.windSastrugi) || 0, reality.fabric.windSastrugi),
      canopyMottle: Math.max(Number(existingFabric.canopyMottle) || 0, reality.fabric.canopyMottle),
      chlorophyllVariation: Math.max(Number(existingFabric.chlorophyllVariation) || 0, reality.fabric.chlorophyllVariation),
      anisotropicCarrierAngle: reality.fields.directionalAngle,
    }),
    normalStrength: Math.max(Number(existing.normalStrength) || 0, reality.fabric.normal),
  });
}

function adjustMaterialScalars(material, reality) {
  if (!material) return;
  const response = reality.fabric;
  const original = material.userData?.worldAssetSurfaceRealityOriginal || null;
  material.userData ||= {};
  if (!original) {
    material.userData.worldAssetSurfaceRealityOriginal = Object.freeze({
      color: material.color?.isColor ? [material.color.r, material.color.g, material.color.b] : null,
      roughness: Number.isFinite(material.roughness) ? material.roughness : null,
      metalness: Number.isFinite(material.metalness) ? material.metalness : null,
      normalScale: material.normalScale?.isVector2 ? [material.normalScale.x, material.normalScale.y] : null,
    });
  }
  if (material.color?.isColor) {
    const brightness = clamp(1 + response.albedo, 0.74, 1.22, 1);
    material.color.multiplyScalar(brightness);
  }
  if (Number.isFinite(material.roughness)) {
    material.roughness = clamp(
      material.roughness * 0.72 + response.roughness * 0.28,
      0.16,
      1,
      material.roughness,
    );
  }
  if (material.normalScale?.isVector2) {
    const normalGain = clamp(0.74 + response.normal * 2.8, 0.72, 1.44, 1);
    material.normalScale.multiplyScalar(normalGain);
  }
  if (Number.isFinite(material.metalness) && reality.profileId === 'metal') {
    const oxidation = reality.environment.oxidation;
    material.metalness = clamp(material.metalness - oxidation * 0.10, 0, 1, material.metalness);
  }
  material.needsUpdate = true;
}

function restoreMaterialScalars(material) {
  const original = material?.userData?.worldAssetSurfaceRealityOriginal;
  if (!original) return false;
  if (original.color && material.color?.isColor) material.color.setRGB(...original.color);
  if (original.roughness !== null && Number.isFinite(original.roughness)) material.roughness = original.roughness;
  if (original.metalness !== null && Number.isFinite(original.metalness)) material.metalness = original.metalness;
  if (original.normalScale && material.normalScale?.isVector2) material.normalScale.set(...original.normalScale);
  delete material.userData.worldAssetSurfaceRealityOriginal;
  delete material.userData.worldAssetSurfaceResponse;
  material.needsUpdate = true;
  return true;
}

function materialNeedsClone(material) {
  return Boolean(material?.userData?.worldAssetSurfaceRealityOwner);
}

function markMaterialOwner(material, objectId) {
  material.userData ||= {};
  material.userData.worldAssetSurfaceRealityOwner = objectId;
}

function getWorldPosition(object) {
  const position = object?.position;
  return {
    x: Number.isFinite(Number(position?.x)) ? Number(position.x) : 0,
    y: Number.isFinite(Number(position?.y)) ? Number(position.y) : 0,
    z: Number.isFinite(Number(position?.z)) ? Number(position.z) : 0,
  };
}

function readPlacementSurface(object) {
  const surface = object?.userData?.worldPlacementSurface;
  return surface && typeof surface === 'object' ? surface : null;
}

function readPlacementContext(object) {
  const context = object?.userData?.worldPlacementMaterialContext;
  return context && typeof context === 'object' ? context : null;
}

function buildObjectRealityContext(object, options = {}) {
  const position = getWorldPosition(object);
  const surface = readPlacementSurface(object) || {};
  const placement = readPlacementContext(object) || {};
  const metadata = options.metadata || {};
  const subject = options.subject || {};
  const signature = materialSignature({
    paletteId: options.paletteId || '',
    subject,
    object,
  });
  const climateId = options.climateId || surface.climateId || placement.climateId || inferSurfaceRealityClimate({ subject, object, climateId: options.climateId });
  const profileId = options.profileId || surface.profileId || inferSurfaceRealityMaterialProfile({
    paletteId: options.paletteId,
    subject,
    object,
  });
  const normalizedX = clamp01(surface.normalizedX ?? placement.normalizedX, 0.5);
  const normalizedZ = clamp01(surface.normalizedZ ?? placement.normalizedZ, 0.5);
  return {
    ...surface,
    ...placement,
    worldX: position.x,
    worldZ: position.z,
    height: surface.height ?? position.y,
    normalizedX,
    normalizedZ,
    profileId,
    climateId,
    seed: options.seed ?? stableSeed(`${signature}|${metadata.id || object?.name || 'asset'}`, 'world-surface'),
    slope: placement.slope ?? surface.slope ?? 0.25,
    exposure: placement.exposure ?? surface.exposure,
    shelter: placement.shelter ?? surface.shelter,
    moisture: placement.moisture ?? surface.moisture,
    aridity: placement.aridity ?? surface.aridity,
    erosion: placement.erosion ?? surface.erosion,
    weathering: placement.weathering ?? surface.weathering,
    frost: placement.frost ?? surface.frost,
    snow: placement.snow ?? surface.snow,
    vegetation: placement.vegetation ?? surface.vegetation,
    dust: placement.dust ?? surface.dust,
    salt: placement.salt ?? surface.salt,
    moss: placement.moss ?? surface.moss,
    lichen: placement.lichen ?? surface.lichen,
    waterProximity: surface.waterProximity ?? surface.distanceToWaterNormalized ?? placement.waterProximity,
    waterDepth: surface.waterDepth,
    riverProximity: surface.riverProximity,
    wetEdge: surface.wetEdge,
    sediment: surface.sediment,
    spray: surface.spray,
    metadata,
  };
}

/**
 * Apply surface reality to one world asset. The operation is idempotent: reapplying with the same
 * identity updates metadata/scalars from the new response but never stacks unbounded color or
 * roughness multiplication.
 */
export function applyWorldAssetSurfaceReality(object, options = {}) {
  if (!object?.traverse) return { ok: false, error: 'missing-object' };
  if (object.userData?.isPlaceholder) return { ok: false, error: 'placeholder-model' };

  const baseContext = buildObjectRealityContext(object, options);
  const reality = resolveWorldAssetSurfaceReality(baseContext);
  const objectId = object.userData?.assetId || object.userData?.editorId || object.name || `asset-${reality.seed}`;
  let meshCount = 0;
  let materialCount = 0;
  const profiles = new Set();

  object.traverse((child) => {
    if (!child?.isMesh && !child?.isInstancedMesh) return;
    meshCount += 1;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    if (child.isInstancedMesh) {
      materials.forEach((material) => {
        if (!material) return;
        updateWorldAssetSurfaceResponse(material, reality);
        adjustMaterialScalars(material, reality);
        markMaterialOwner(material, objectId);
        materialCount += 1;
        profiles.add(reality.profileId);
      });
      return;
    }

    const nextMaterials = materials.map((material) => {
      if (!material?.isMaterial) return material;
      const currentOwner = material.userData?.worldAssetSurfaceRealityOwner;
      const shouldClone = currentOwner && currentOwner !== objectId;
      const target = shouldClone ? cloneMaterialIfNeeded(material) : material;
      updateWorldAssetSurfaceResponse(target, reality);
      adjustMaterialScalars(target, reality);
      markMaterialOwner(target, objectId);
      materialCount += 1;
      profiles.add(reality.profileId);
      return target;
    });
    child.material = nextMaterials.length === 1 ? nextMaterials[0] : nextMaterials;
  });

  object.userData.worldAssetSurfaceReality = Object.freeze({
    ...reality,
    objectId,
    meshCount,
    materialCount,
    profileIds: Object.freeze([...profiles].sort()),
    applied: true,
  });

  return {
    ok: true,
    policyId: WORLD_ASSET_SURFACE_REALITY_POLICY.id,
    object,
    reality,
    meshCount,
    materialCount,
    profileIds: [...profiles].sort(),
  };
}

export function restoreWorldAssetSurfaceReality(object) {
  if (!object?.traverse) return 0;
  let restored = 0;
  object.traverse((child) => {
    if (!child?.isMesh && !child?.isInstancedMesh) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (restoreMaterialScalars(material)) restored += 1;
    });
  });
  if (restored) delete object.userData.worldAssetSurfaceReality;
  return restored;
}

export function validateWorldAssetSurfaceReality(object) {
  const state = object?.userData?.worldAssetSurfaceReality;
  const errors = [];
  if (!state) errors.push('surface-reality-not-applied');
  else if (state.policyId !== WORLD_ASSET_SURFACE_REALITY_POLICY.id) errors.push('surface-reality-policy-mismatch');
  else if (!state.reality?.diagnostics?.finite) errors.push('non-finite-reality');

  let materials = 0;
  let realityMaterials = 0;
  object?.traverse?.((child) => {
    const list = Array.isArray(child?.material) ? child.material : [child?.material];
    for (const material of list) {
      if (!material?.isMaterial) continue;
      materials += 1;
      if (material.userData?.worldAssetSurfaceResponse?.policyId === WORLD_ASSET_SURFACE_REALITY_POLICY.id) realityMaterials += 1;
    }
  });
  if (materials && realityMaterials === 0) errors.push('no-reality-materials');
  return Object.freeze({
    ok: errors.length === 0,
    errors,
    materials,
    realityMaterials,
    state: state || null,
  });
}

export function surfaceRealityFingerprint(reality) {
  if (!reality) return '';
  const values = [
    reality.policyId,
    reality.profileId,
    reality.climateId,
    reality.seed,
    reality.fabric?.albedo,
    reality.fabric?.roughness,
    reality.fabric?.normal,
    reality.fabric?.strata,
    reality.fabric?.grain,
    reality.environment?.runoff,
    reality.environment?.salt,
    reality.environment?.frost,
    reality.environment?.dust,
    reality.environment?.moss,
    reality.environment?.lichen,
    reality.fields?.macro,
    reality.fields?.meso,
    reality.fields?.fine,
    reality.fields?.grain,
  ];
  return values.map((value) => {
    if (typeof value === 'number') return value.toFixed(8);
    return String(value);
  }).join('|');
}

export function compareSurfaceReality(a, b) {
  const fingerprintA = surfaceRealityFingerprint(a);
  const fingerprintB = surfaceRealityFingerprint(b);
  return Object.freeze({
    deterministic: fingerprintA === fingerprintB,
    fingerprintA,
    fingerprintB,
  });
}

export function createSurfaceRealityMatrix(samples = []) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  return Object.freeze(samples.map((sample, index) => {
    const reality = resolveWorldAssetSurfaceReality({
      ...sample,
      seed: sample?.seed ?? index * 7919,
    });
    return Object.freeze({
      index,
      profileId: reality.profileId,
      climateId: reality.climateId,
      fingerprint: surfaceRealityFingerprint(reality),
      reality,
    });
  }));
}

export function assertWorldAssetSurfaceRealityContract() {
  const probes = [
    { worldX: 0, worldZ: 0, profileId: 'stone', climateId: 'temperate', moisture: 0.55, exposure: 0.45, seed: 101 },
    { worldX: 420, worldZ: -330, profileId: 'wood', climateId: 'coastal', moisture: 0.76, salt: 0.50, wetEdge: 0.40, seed: 202 },
    { worldX: -740, worldZ: 880, profileId: 'metal', climateId: 'coastal', salt: 0.67, spray: 0.55, exposure: 0.75, seed: 303 },
    { worldX: 1260, worldZ: 470, profileId: 'snow', climateId: 'glacial', frost: 0.95, snow: 0.92, seed: 404 },
    { worldX: -1370, worldZ: -910, profileId: 'soil', climateId: 'arid', moisture: 0.18, dust: 0.78, seed: 505 },
    { worldX: 2110, worldZ: -640, profileId: 'vegetation', climateId: 'wetland', moisture: 0.88, vegetation: 0.91, seed: 606 },
    { worldX: -1980, worldZ: 1300, profileId: 'stone', climateId: 'volcanic', exposure: 0.79, erosion: 0.91, sediment: 0.18, seed: 707 },
  ];
  const first = probes.map((probe) => resolveWorldAssetSurfaceReality(probe));
  const second = probes.map((probe) => resolveWorldAssetSurfaceReality({ ...probe }));
  for (let index = 0; index < first.length; index += 1) {
    const compared = compareSurfaceReality(first[index], second[index]);
    if (!compared.deterministic) throw new Error(`surface reality determinism failure at probe ${index}`);
    if (!first[index].diagnostics.finite) throw new Error(`surface reality non-finite at probe ${index}`);
  }
  const range = first.flatMap((reality) => [reality.fabric.roughness, reality.fabric.normal, reality.fabric.albedo]);
  if (range.some((value) => !Number.isFinite(value))) throw new Error('surface reality response range contains non-finite value');
  if (first.some((reality) => reality.fabric.roughness < 0.18 || reality.fabric.roughness > 1)) throw new Error('surface reality roughness outside bounded range');
  if (first.some((reality) => reality.fabric.normal < 0.015 || reality.fabric.normal > 0.30)) throw new Error('surface reality normal outside bounded range');
  return Object.freeze({
    ok: true,
    sampleCount: probes.length,
    fingerprints: Object.freeze(first.map(surfaceRealityFingerprint)),
    profiles: Object.freeze([...new Set(first.map((reality) => reality.profileId))].sort()),
    climates: Object.freeze([...new Set(first.map((reality) => reality.climateId))].sort()),
  });
}

/**
 * A compact set of deterministic ecological transitions used by callers which already possess
 * canonical surface values. These do not decide geography; they only turn known values into material
 * weights. Keeping the transition vocabulary here makes hydrology, cryosphere and settlement-facing
 * material consumers agree on the same visual response family without sharing placement ownership.
 */
export const SURFACE_REALITY_TRANSITIONS = Object.freeze({
  wetEdge: Object.freeze({
    start: 0.08,
    full: 0.78,
    darken: 0.22,
    roughnessDelta: -0.11,
    sediment: 0.34,
    salt: 0.12,
  }),
  spray: Object.freeze({
    start: 0.16,
    full: 0.72,
    darken: 0.08,
    roughnessDelta: 0.06,
    sediment: 0.08,
    salt: 0.42,
  }),
  frost: Object.freeze({
    start: 0.24,
    full: 0.81,
    darken: 0.04,
    roughnessDelta: 0.09,
    sediment: 0.02,
    salt: 0.01,
  }),
  dust: Object.freeze({
    start: 0.22,
    full: 0.79,
    darken: 0.03,
    roughnessDelta: 0.07,
    sediment: 0.08,
    salt: 0.02,
  }),
  lichen: Object.freeze({
    start: 0.28,
    full: 0.82,
    darken: 0.06,
    roughnessDelta: 0.04,
    sediment: 0.01,
    salt: 0.00,
  }),
  oxidation: Object.freeze({
    start: 0.19,
    full: 0.78,
    darken: 0.05,
    roughnessDelta: 0.12,
    sediment: 0.00,
    salt: 0.08,
  }),
});

export function resolveSurfaceRealityTransition(kind, amount, gain = 1) {
  const transition = SURFACE_REALITY_TRANSITIONS[kind];
  if (!transition) return 0;
  const normalized = smoothstep(transition.start, transition.full, clamp01(amount));
  return clamp01(normalized * clamp01(gain, 1), 0);
}

export function surfaceRealityTransitionBundle(context = {}) {
  const wet = resolveSurfaceRealityTransition('wetEdge', context.wetEdge, 1);
  const spray = resolveSurfaceRealityTransition('spray', context.spray, 1);
  const frost = resolveSurfaceRealityTransition('frost', context.frost, 1);
  const dust = resolveSurfaceRealityTransition('dust', context.dust, 1);
  const lichen = resolveSurfaceRealityTransition('lichen', context.lichen, 1);
  const oxidation = resolveSurfaceRealityTransition('oxidation', context.oxidation, 1);
  return Object.freeze({ wet, spray, frost, dust, lichen, oxidation });
}

export function applySurfaceRealityTransitionHints(response, context = {}) {
  if (!response || typeof response !== 'object') throw new TypeError('response must be an object');
  const transitions = surfaceRealityTransitionBundle(context);
  const wet = SURFACE_REALITY_TRANSITIONS.wetEdge;
  const spray = SURFACE_REALITY_TRANSITIONS.spray;
  const frost = SURFACE_REALITY_TRANSITIONS.frost;
  const dust = SURFACE_REALITY_TRANSITIONS.dust;
  const lichen = SURFACE_REALITY_TRANSITIONS.lichen;
  const oxidation = SURFACE_REALITY_TRANSITIONS.oxidation;
  return Object.freeze({
    ...response,
    albedo: clamp((response.albedo ?? 0) - transitions.wet * wet.darken - transitions.spray * spray.darken - transitions.lichen * lichen.darken + transitions.dust * 0.018, -0.30, 0.30, 0),
    roughness: clamp((response.roughness ?? 0.84)
      + transitions.wet * wet.roughnessDelta
      + transitions.spray * spray.roughnessDelta
      + transitions.frost * frost.roughnessDelta
      + transitions.dust * dust.roughnessDelta
      + transitions.lichen * lichen.roughnessDelta
      + transitions.oxidation * oxidation.roughnessDelta,
      0.12, 1.0, 0.84),
    normal: clamp((response.normal ?? 0.05)
      + transitions.wet * 0.008
      + transitions.spray * 0.005
      + transitions.frost * 0.006
      + transitions.dust * 0.004
      + transitions.lichen * 0.003
      + transitions.oxidation * 0.006,
      0.012, 0.32, 0.05),
    wetTransition: transitions.wet,
    sprayTransition: transitions.spray,
    frostTransition: transitions.frost,
    dustTransition: transitions.dust,
    lichenTransition: transitions.lichen,
    oxidationTransition: transitions.oxidation,
  });
}

export function resolveContextualSurfaceResponse(context = {}) {
  const reality = resolveWorldAssetSurfaceReality(context);
  const enhanced = applySurfaceRealityTransitionHints(reality.fabric, {
    wetEdge: reality.context.wetEdge,
    spray: reality.context.spray,
    frost: reality.context.frost,
    dust: reality.context.dust,
    lichen: reality.environment.lichen,
    oxidation: reality.environment.oxidation,
  });
  return Object.freeze({
    ...reality,
    fabric: enhanced,
    fingerprint: surfaceRealityFingerprint({ ...reality, fabric: enhanced }),
  });
}

export function worldAssetSurfaceRealitySummary(objects = []) {
  if (!Array.isArray(objects)) throw new TypeError('objects must be an array');
  const profiles = new Map();
  const climates = new Map();
  let materialCount = 0;
  let realityCount = 0;
  for (const object of objects) {
    const state = object?.userData?.worldAssetSurfaceReality;
    if (state?.profileId) profiles.set(state.profileId, (profiles.get(state.profileId) || 0) + 1);
    if (state?.climateId) climates.set(state.climateId, (climates.get(state.climateId) || 0) + 1);
    object?.traverse?.((child) => {
      const list = Array.isArray(child?.material) ? child.material : [child?.material];
      for (const material of list) {
        if (!material?.isMaterial) continue;
        materialCount += 1;
        if (material.userData?.worldAssetSurfaceResponse?.policyId === WORLD_ASSET_SURFACE_REALITY_POLICY.id) realityCount += 1;
      }
    });
  }
  return Object.freeze({
    objectCount: objects.length,
    materialCount,
    realityMaterialCount: realityCount,
    realityCoverage: materialCount ? realityCount / materialCount : 0,
    profileCounts: Object.freeze(Object.fromEntries([...profiles.entries()].sort())),
    climateCounts: Object.freeze(Object.fromEntries([...climates.entries()].sort())),
  });
}

export function createSurfaceRealityPalette(context = {}) {
  const profileId = PROFILE_LIBRARY[context.profileId] ? context.profileId : inferSurfaceRealityMaterialProfile(context);
  const climateId = CLIMATE_LIBRARY[context.climateId] ? context.climateId : inferSurfaceRealityClimate(context);
  const profile = PROFILE_LIBRARY[profileId];
  const climate = CLIMATE_LIBRARY[climateId];
  return Object.freeze({
    profileId,
    climateId,
    baseRoughness: profile.roughnessBase,
    normalStrength: profile.normalGain,
    macroMeters: profile.macroMeters,
    mesoMeters: profile.mesoMeters,
    fineMeters: profile.fineMeters,
    moisture: climate.moisture,
    frost: climate.frost,
    salt: climate.salt,
    dust: climate.dust,
    moss: climate.moss,
    lichen: climate.lichen,
    snowPersistence: climate.snowPersistence,
  });
}

export function materialRealityRoleFromString(value) {
  const signature = normalizeString(value);
  for (const [role, pattern] of ROLE_PATTERNS) {
    if (pattern.test(signature)) return role;
  }
  return 'generic';
}

export function climateRealityFromString(value) {
  const signature = normalizeString(value);
  for (const [climate, pattern] of CLIMATE_HINTS) {
    if (pattern.test(signature)) return climate;
  }
  return 'temperate';
}

export function isSurfaceRealityMaterialProfile(value) {
  return Boolean(PROFILE_LIBRARY[value]);
}

export function isSurfaceRealityClimate(value) {
  return Boolean(CLIMATE_LIBRARY[value]);
}

export function listSurfaceRealityProfiles() {
  return Object.freeze(Object.keys(PROFILE_LIBRARY));
}

export function listSurfaceRealityClimates() {
  return Object.freeze(Object.keys(CLIMATE_LIBRARY));
}

export function profileLibrarySnapshot() {
  return Object.freeze(JSON.parse(JSON.stringify(PROFILE_LIBRARY)));
}

export function climateLibrarySnapshot() {
  return Object.freeze(JSON.parse(JSON.stringify(CLIMATE_LIBRARY)));
}

export function worldAssetSurfaceRealityVersion() {
  return WORLD_ASSET_SURFACE_REALITY_POLICY.id;
}

export default Object.freeze({
  WORLD_ASSET_SURFACE_REALITY_POLICY,
  SURFACE_REALITY_TRANSITIONS,
  inferSurfaceRealityMaterialProfile,
  inferSurfaceRealityClimate,
  resolveWorldAssetSurfaceReality,
  applyWorldAssetSurfaceReality,
  restoreWorldAssetSurfaceReality,
  validateWorldAssetSurfaceReality,
  surfaceRealityFingerprint,
  compareSurfaceReality,
  createSurfaceRealityMatrix,
  assertWorldAssetSurfaceRealityContract,
  resolveSurfaceRealityTransition,
  surfaceRealityTransitionBundle,
  applySurfaceRealityTransitionHints,
  resolveContextualSurfaceResponse,
  worldAssetSurfaceRealitySummary,
  createSurfaceRealityPalette,
  materialRealityRoleFromString,
  climateRealityFromString,
  isSurfaceRealityMaterialProfile,
  isSurfaceRealityClimate,
  listSurfaceRealityProfiles,
  listSurfaceRealityClimates,
  profileLibrarySnapshot,
  climateLibrarySnapshot,
  worldAssetSurfaceRealityVersion,
});
