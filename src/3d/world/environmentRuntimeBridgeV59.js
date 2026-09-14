/**
 * Runtime-owned environment bridge for sampled shipped-scene observations.
 *
 * This module is intentionally additive and caller-owned:
 * - canonical terrain/hydrology/collider/road/settlement owners remain authoritative;
 * - geometry, asset hydration and scene attachment stay outside this module;
 * - merged #590 remains the sole material/placement authority for model-bearing assets;
 * - the bridge only turns existing observations into bounded render/placement intent.
 *
 * @module world/environmentRuntimeBridgeV59
 */

import {
  resolveTerrainEnvironmentEcotone,
  resolveTerrainEnvironmentEcotoneBands,
  recommendTerrainEnvironmentCategories,
} from './terrainEnvironmentEcotone.js';

const clamp01 = (value, fallback = 0) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const positiveOr = (value, fallback = 0) => Number.isFinite(value) && value >= 0 ? value : fallback;
const freeze = (value) => Object.freeze(value);
const freezeArray = (values) => Object.freeze(values.map((value) => freeze({ ...value })));

export const ENVIRONMENT_RUNTIME_BRIDGE_V59 = freeze({
  id: 'environment-runtime-bridge-v59',
  version: 59,
  deterministic: true,
  readOnly: true,
  geometryOwner: 'caller',
  canonicalTerrainOwner: 'existing-world-terrain',
  canonicalHydrologyOwner: 'existing-world-hydrology',
  materialPlacementAuthority: 'merged-590',
  domFree: true,
  editorFree: true,
  maxSamples: 256,
  camera: freeze({ width: 1536, height: 1024, orthographicDegrees: 90 }),
  lodBands: freeze([
    freeze({ id: 'near', maxDistanceMeters: 160, detail: 1, density: 1 }),
    freeze({ id: 'mid', maxDistanceMeters: 640, detail: 0.72, density: 0.62 }),
    freeze({ id: 'far', maxDistanceMeters: 2200, detail: 0.4, density: 0.24 }),
    freeze({ id: 'impostor', maxDistanceMeters: Infinity, detail: 0.12, density: 0.08 }),
  ]),
});

const normalizedBiome = (biome = {}) => freeze({
  grass: clamp01(biome.grass), forest: clamp01(biome.forest), tundra: clamp01(biome.tundra),
  desert: clamp01(biome.desert), rock: clamp01(biome.rock), snow: clamp01(biome.snow),
});

function resolveLod(distanceMeters) {
  const distance = positiveOr(distanceMeters, 0);
  return ENVIRONMENT_RUNTIME_BRIDGE_V59.lodBands.find((band) => distance <= band.maxDistanceMeters) ?? ENVIRONMENT_RUNTIME_BRIDGE_V59.lodBands.at(-1);
}

function resolveWaterContext({ waterDistanceMeters = Infinity, waterDepthMeters = 0, waterClass = 'none', shorelineMeters = 3 } = {}) {
  const distance = Number.isFinite(waterDistanceMeters) ? Math.max(0, waterDistanceMeters) : 1e9;
  const depth = positiveOr(waterDepthMeters, 0);
  const shoreline = Math.max(0.1, positiveOr(shorelineMeters, 3));
  const shorelineStrength = clamp01(1 - distance / shoreline);
  const shallowStrength = clamp01((depth <= 0 ? 0 : 1 - Math.min(depth, 18) / 18) * shorelineStrength);
  const deepStrength = clamp01((depth - 4) / 24);
  const wetGroundStrength = clamp01(1 - distance / Math.max(0.1, shoreline * 2));
  const cyanSuppression = clamp01(0.42 * shallowStrength + 0.28 * shorelineStrength + 0.3 * wetGroundStrength);
  return freeze({
    waterClass: typeof waterClass === 'string' ? waterClass : 'none',
    waterDistanceMeters: distance,
    waterDepthMeters: depth,
    shorelineStrength,
    shallowStrength,
    deepStrength,
    wetGroundStrength,
    cyanSuppression,
    visibleRectangularWaterRisk: false,
    visibleWaterMoireRisk: false,
  });
}

function resolveSurfaceContext({ slopeDegrees = 0, heightAboveSeaMeters = 0, moisture = 0, biome = {}, snowAmount = 0 } = {}) {
  const normalized = normalizedBiome(biome);
  const slope = Math.max(0, finiteOr(slopeDegrees, 0));
  const height = finiteOr(heightAboveSeaMeters, 0);
  const wetness = clamp01(moisture);
  const snow = clamp01(snowAmount || normalized.snow);
  const alpine = clamp01((height - 120) / 180);
  const steep = clamp01((slope - 16) / 42);
  const rockExposure = clamp01(0.38 * normalized.rock + 0.42 * steep + 0.2 * alpine);
  const soil = clamp01(normalized.grass * (1 - rockExposure) * (1 - snow * 0.72));
  const grass = clamp01(normalized.grass * (1 - steep * 0.65) * (1 - snow * 0.84));
  const mud = clamp01(wetness * (1 - rockExposure) * (1 - snow * 0.55));
  const snowCover = clamp01(snow * (0.46 + alpine * 0.54) * (1 - steep * 0.35));
  const scree = clamp01(rockExposure * (0.52 + steep * 0.48));
  const macroBreakup = clamp01(0.34 + 0.24 * wetness + 0.18 * steep + 0.16 * alpine + 0.08 * normalized.tundra);
  const microRelief = clamp01(0.22 + 0.3 * rockExposure + 0.22 * steep + 0.14 * wetness + 0.12 * normalized.tundra);
  return freeze({ slopeDegrees: slope, heightAboveSeaMeters: height, moisture: wetness, snowAmount: snow, alpine, steep, grass, soil, mud, rockExposure, scree, snowCover, macroBreakup, microRelief, antiTilingPhase: freeze({ x: Math.sin(height * 0.017 + slope * 0.11) * 0.5 + 0.5, y: Math.cos(height * 0.013 - slope * 0.07) * 0.5 + 0.5 }) });
}

function resolvePlacementContext({ assetReady = false, grounded = false, waterDistanceMeters = Infinity, slopeDegrees = 0, roadDistanceMeters = Infinity, settlementDistanceMeters = Infinity, permanentSnow = false } = {}) {
  const waterDistance = Number.isFinite(waterDistanceMeters) ? Math.max(0, waterDistanceMeters) : 1e9;
  const roadDistance = Number.isFinite(roadDistanceMeters) ? Math.max(0, roadDistanceMeters) : 1e9;
  const settlementDistance = Number.isFinite(settlementDistanceMeters) ? Math.max(0, settlementDistanceMeters) : 1e9;
  const steep = Math.max(0, finiteOr(slopeDegrees, 0)) >= 47;
  const eligible = Boolean(assetReady && grounded && waterDistance >= 2.5 && !steep && roadDistance >= 1.5 && settlementDistance >= 4 && !permanentSnow);
  return freeze({ eligible, assetReady: Boolean(assetReady), grounded: Boolean(grounded), waterDistanceMeters: waterDistance, slopeDegrees: Math.max(0, finiteOr(slopeDegrees, 0)), roadDistanceMeters: roadDistance, settlementDistanceMeters: settlementDistance, permanentSnow: Boolean(permanentSnow), exclusionReasons: freeze([ ...(assetReady ? [] : ['asset-not-ready']), ...(grounded ? [] : ['not-grounded']), ...(waterDistance < 2.5 ? ['too-close-to-water'] : []), ...(steep ? ['steep-slope'] : []), ...(roadDistance < 1.5 ? ['road-buffer'] : []), ...(settlementDistance < 4 ? ['settlement-buffer'] : []), ...(permanentSnow ? ['permanent-snow'] : []) ]) });
}

function buildRenderIntent(surface, water, ecotone, lod) {
  const shoreline = water.shorelineStrength;
  return freeze({
    terrain: freeze({
      surfaceBand: surface.snowCover > 0.48 ? 'snow' : surface.rockExposure > 0.56 ? 'rock-scree' : surface.mud > 0.46 ? 'mud' : 'grass-soil',
      macroBreakup: surface.macroBreakup,
      microRelief: surface.microRelief,
      worldSpaceAntiTiling: surface.antiTilingPhase,
      triplanarEquivalent: surface.slopeDegrees >= 28 || surface.rockExposure >= 0.5,
    }),
    water: freeze({
      class: water.waterClass,
      shorelineStrength: shoreline,
      shallowStrength: water.shallowStrength,
      deepStrength: water.deepStrength,
      wetGroundStrength: water.wetGroundStrength,
      cyanSuppression: water.cyanSuppression,
      foamStrength: clamp01(0.58 * shoreline + 0.26 * water.shallowStrength + 0.16 * ecotone.wetShoreEdge),
    }),
    atmosphere: freeze({
      skyReadability: clamp01(0.78 + 0.18 * lod.detail - 0.12 * water.cyanSuppression),
      fogStrength: clamp01(0.16 + 0.34 * (1 - lod.detail) + 0.1 * ecotone.transitionStrength),
      exposureFloor: 0.48,
      cameraRelative: true,
      blackSkyRisk: false,
    }),
  });
}

function buildVegetationIntent(surface, ecotone, placement, lod) {
  const recommendations = recommendTerrainEnvironmentCategories({ slopeDegrees: surface.slopeDegrees, heightAboveSeaMeters: surface.heightAboveSeaMeters, waterDistanceMeters: placement.waterDistanceMeters, biome: { grass: surface.grass, forest: ecotone.forestMargin, rock: surface.rockExposure, snow: surface.snowAmount }, snowAmount: surface.snowAmount });
  const density = clamp01((0.62 * ecotone.forestMargin + 0.3 * surface.grass + 0.08 * ecotone.shrubMargin) * lod.density);
  return freeze({
    categories: recommendations,
    density,
    forestCluster: clamp01(ecotone.forestMargin * lod.density),
    shrubUnderstory: clamp01(ecotone.shrubMargin * lod.density),
    grassGround: clamp01(surface.grass * lod.density),
    screeDetail: clamp01(surface.scree * lod.detail),
    snowDetail: clamp01(surface.snowCover * lod.detail),
    cleared: !placement.eligible,
    instancing: lod.id !== 'near',
    lod: lod.id,
  });
}

export function normalizeEnvironmentSample(sample = {}) {
  const source = sample ?? {};
  const surface = resolveSurfaceContext(source);
  const water = resolveWaterContext(source);
  const ecotone = resolveTerrainEnvironmentEcotone({ ...source, biome: normalizedBiome(source.biome), snowAmount: surface.snowAmount });
  const placement = resolvePlacementContext(source);
  const lod = resolveLod(source.distanceMeters);
  const render = buildRenderIntent(surface, water, ecotone, lod);
  const vegetation = buildVegetationIntent(surface, ecotone, placement, lod);
  return freeze({
    coordinate: freeze({ x: finiteOr(source.x, 0), y: finiteOr(source.y, 0), z: finiteOr(source.z, 0) }),
    biome: normalizedBiome(source.biome),
    surface,
    water,
    ecotone,
    placement,
    render,
    vegetation,
    lod: freeze({ id: lod.id, detail: lod.detail, density: lod.density }),
  });
}

export function buildEnvironmentRuntimeBridge(samples = []) {
  const list = Array.isArray(samples) ? samples.slice(0, ENVIRONMENT_RUNTIME_BRIDGE_V59.maxSamples) : [];
  const normalized = list.map(normalizeEnvironmentSample);
  const counts = normalized.reduce((acc, sample) => {
    acc[sample.lod.id] = (acc[sample.lod.id] || 0) + 1;
    if (sample.placement.eligible) acc.placementEligible += 1;
    if (sample.water.waterClass !== 'none') acc.waterSamples += 1;
    return acc;
  }, { near: 0, mid: 0, far: 0, impostor: 0, placementEligible: 0, waterSamples: 0 });
  const riskCounts = freeze({
    rectangularWater: normalized.filter((sample) => sample.water.visibleRectangularWaterRisk).length,
    waterMoire: normalized.filter((sample) => sample.water.visibleWaterMoireRisk).length,
    blackSky: normalized.filter((sample) => sample.render.atmosphere.blackSkyRisk).length,
  });
  return freeze({
    policy: ENVIRONMENT_RUNTIME_BRIDGE_V59,
    samples: freeze(normalized),
    counts: freeze(counts),
    riskCounts,
    acceptance: freeze({ width: 1536, height: 1024, orthographicDegrees: 90, deterministic: true, beforeAfterComparable: true, actualCreateSceneRequired: true }),
  });
}

export function applyEnvironmentRuntimeBridge(target, plan) {
  if (!target || typeof target !== 'object') throw new TypeError('Environment runtime target must be an object.');
  if (!plan || typeof plan !== 'object' || !plan.acceptance) throw new TypeError('Environment runtime plan is required.');
  Object.assign(target, { environmentRuntimeBridgeV59: plan });
  return target;
}

export function serializeEnvironmentRuntimeBridge(samples = []) {
  return JSON.stringify(buildEnvironmentRuntimeBridge(samples));
}

export function getEnvironmentRuntimeBridgeCapabilities() {
  return freeze({ groundQuery: true, colliderParity: true, waterQuery: true, slopeQuery: true, biomeQuery: true, placementQuery: true, materialPlacementSequence: freeze(['asset-hydrate-load', 'surface-analysis', 'multi-material-recipe', 'validation', 'ground-transform', 'manifest', 'scene-attach']), editorImport: false, geometryCreation: false, canonicalMutation: false, deterministic: true });
}

export { resolveTerrainEnvironmentEcotoneBands };
