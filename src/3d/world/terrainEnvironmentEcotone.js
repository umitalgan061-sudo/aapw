/**
 * Read-only environment ecotone resolver for terrain consumers.
 *
 * Converts already-authoritative biome/slope/water/snow context into continuous edge strengths used
 * for forest margins, shrub belts, exposed scree, snowline and wet shoreline placement. This is not
 * a second biome generator: it only blends supplied weights and terrain telemetry, never creates a
 * world mask or changes canonical geography.
 * @module world/terrainEnvironmentEcotone
 */

const clamp01 = (value) => Math.max(0, Math.min(1, value));
const finiteOr = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
function smoothstep(a, b, value) {
  const t = clamp01((finiteOr(value) - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
}

export const TERRAIN_ENVIRONMENT_ECOTONE_POLICY = Object.freeze({
  id: 'terrain-environment-ecotone-2026-09-08-v1-continuous-edge-context',
  readOnly: true,
  deterministic: true,
  biomeAuthorityUnchanged: true,
  heightAuthorityUnchanged: true,
  hydrologyAuthorityUnchanged: true,
  placementAuthorityUnchanged: true,
  periodicGrid: false,
  binaryMask: false,
  forestSlopeStartDegrees: 12,
  forestSlopeFullDegrees: 34,
  shrubSlopeStartDegrees: 18,
  shrubSlopeFullDegrees: 42,
  screeSlopeStartDegrees: 30,
  screeSlopeFullDegrees: 58,
  snowlineSlopeStartDegrees: 20,
  snowlineSlopeFullDegrees: 48,
  shorelineBandMeters: 3,
  wetGroundBandMeters: 6,
  forestHeightFadeStartMeters: 90,
  forestHeightFadeFullMeters: 175,
});

function normalizeBiome(biome = {}) {
  return Object.freeze({
    grass: clamp01(finiteOr(biome.grass)),
    forest: clamp01(finiteOr(biome.forest)),
    tundra: clamp01(finiteOr(biome.tundra)),
    desert: clamp01(finiteOr(biome.desert)),
    rock: clamp01(finiteOr(biome.rock)),
    snow: clamp01(finiteOr(biome.snow)),
  });
}

export function resolveTerrainEnvironmentEcotone({
  slopeDegrees = 0,
  heightAboveSeaMeters = 0,
  waterDistanceMeters = Infinity,
  biome = {},
  snowAmount = 0,
  forestAmount = null,
  rockAmount = null,
} = {}) {
  const P = TERRAIN_ENVIRONMENT_ECOTONE_POLICY;
  const slope = Math.max(0, finiteOr(slopeDegrees));
  const height = finiteOr(heightAboveSeaMeters);
  const waterDistance = Math.max(0, finiteOr(waterDistanceMeters, 1e9));
  const normalized = normalizeBiome(biome);
  const forest = clamp01(forestAmount == null ? normalized.forest : forestAmount);
  const rock = clamp01(rockAmount == null ? normalized.rock : rockAmount);
  const snow = clamp01(snowAmount || normalized.snow);
  const forestSlopeFade = 1 - smoothstep(P.forestSlopeStartDegrees, P.forestSlopeFullDegrees, slope);
  const forestHeightFade = 1 - smoothstep(P.forestHeightFadeStartMeters, P.forestHeightFadeFullMeters, height);
  const shrubSlopeBand = smoothstep(P.shrubSlopeStartDegrees, P.shrubSlopeFullDegrees, slope);
  const screeSlopeBand = smoothstep(P.screeSlopeStartDegrees, P.screeSlopeFullDegrees, slope);
  const snowlineBand = smoothstep(P.snowlineSlopeStartDegrees, P.snowlineSlopeFullDegrees, slope);
  const shoreline = clamp01(1 - waterDistance / Math.max(0.001, P.shorelineBandMeters));
  const wetGround = clamp01(1 - waterDistance / Math.max(0.001, P.wetGroundBandMeters));
  const forestMargin = clamp01(forest * forestSlopeFade * forestHeightFade);
  const shrubMargin = clamp01((1 - forest) * (0.32 + normalized.grass * 0.48) * shrubSlopeBand * (1 - snow * 0.72));
  const grassRockEdge = clamp01(normalized.grass * rock * (0.35 + screeSlopeBand * 0.65));
  const screeEdge = clamp01((rock * 0.62 + screeSlopeBand * 0.38) * screeSlopeBand);
  const snowlineEdge = clamp01(snow * (0.42 + snowlineBand * 0.58) * (1 - shoreline * 0.55));
  const wetShoreEdge = clamp01(wetGround * (0.44 + shoreline * 0.56) * (1 - snow * 0.40));
  const exposedGround = clamp01((1 - normalized.forest * 0.55) * (1 - snow * 0.48) * (0.42 + rock * 0.58));
  const ecotone = Object.freeze({
    forestMargin,
    shrubMargin,
    grassRockEdge,
    screeEdge,
    snowlineEdge,
    wetShoreEdge,
    exposedGround,
    shoreline,
    wetGround,
    slopeDegrees: slope,
    heightAboveSeaMeters: height,
    waterDistanceMeters: waterDistance,
  });
  return ecotone;
}

export function resolveTerrainEnvironmentEcotoneLayers(options = {}) {
  const e = resolveTerrainEnvironmentEcotone(options);
  return Object.freeze({
    forestCanopy: e.forestMargin,
    shrubUnderstory: e.shrubMargin,
    grassToRockTransition: e.grassRockEdge,
    exposedScree: e.screeEdge,
    snowline: e.snowlineEdge,
    wetShoreline: e.wetShoreEdge,
    exposedGround: e.exposedGround,
  });
}

export function recommendTerrainEnvironmentCategories(options = {}) {
  const e = resolveTerrainEnvironmentEcotone(options);
  const recommendations = [];
  if (e.forestMargin > 0.18) recommendations.push('tree-cluster');
  if (e.shrubMargin > 0.16) recommendations.push('shrub-cluster');
  if (e.exposedGround > 0.25) recommendations.push('grass-ground');
  if (e.screeEdge > 0.18) recommendations.push('rock-scree');
  if (e.snowlineEdge > 0.18) recommendations.push('snow-detail');
  if (e.wetShoreEdge > 0.18) recommendations.push('wet-edge');
  return Object.freeze(recommendations);
}

export function serializeTerrainEnvironmentEcotone(options = {}) {
  const e = resolveTerrainEnvironmentEcotone(options);
  return JSON.stringify(e);
}

export const resolveEnvironmentEcotone = resolveTerrainEnvironmentEcotone;
export const recommendEnvironmentCategories = recommendTerrainEnvironmentCategories;
