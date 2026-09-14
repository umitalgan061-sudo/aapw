/*
 * Canonical geographic context for world-asset distribution.
 *
 * This module is deliberately renderer-agnostic. It does not create terrain, hydrology, roads,
 * settlements, colliders or new map regions. It consumes already-resolved world-surface evidence and
 * converts that evidence into a stable, bounded asset-distribution context. Producers can use the
 * context to choose an authored family, density, scale, rotation bias, micro-cluster behavior and
 * ecological exclusions without inventing a second geography authority.
 *
 * The important design rule is that every derived number is deterministic from the same world X/Z,
 * source id and caller seed. A producer can therefore re-run the decision after loading a GLB without
 * changing the world layout. All weights are clamped and the module is safe to call in headless QA.
 */

const clamp01 = (value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));
const lerp = (a, b, t) => a + (b - a) * clamp01(t);
const smoothstep = (a, b, value) => {
  if (a === b) return value >= b ? 1 : 0;
  const t = clamp01((value - a) / (b - a));
  return t * t * (3 - 2 * t);
};

export const GEOGRAPHIC_ASSET_CONTEXT_POLICY = Object.freeze({
  id: 'geographic-asset-context-2026-09-14-v1',
  deterministic: true,
  rendererAgnostic: true,
  canonicalInputsOnly: true,
  createsNoGeometry: true,
  createsNoHydrology: true,
  createsNoRoads: true,
  createsNoSettlements: true,
  createsNoColliders: true,
  seedStrategy: 'world-xz-plus-asset-id-plus-caller-seed',
  contextVersion: 1,
  bounds: Object.freeze({
    densityMin: 0,
    densityMax: 1,
    suitabilityMin: 0,
    suitabilityMax: 1,
    scaleMin: 0.58,
    scaleMax: 1.42,
    clusterMin: 0,
    clusterMax: 1,
    roadInfluenceMaxMeters: 260,
    settlementInfluenceMaxMeters: 520,
    shoreInfluenceMaxMeters: 460,
  }),
  seeds: Object.freeze({
    selection: 0x1b873593,
    patch: 0x62e7f91d,
    scale: 0xa1f0d44b,
    rotation: 0x3f2e89c1,
    density: 0x94d049bb,
    cluster: 0x77c6a7f3,
  }),
});

export const GEOGRAPHIC_ASSET_FAMILY_PROFILES = Object.freeze({
  broadleaf: Object.freeze({
    id: 'broadleaf',
    kind: 'vegetation',
    preferredBiomes: ['temperate', 'lush-lowland', 'coast', 'grassland'],
    toleratedBiomes: ['steppe', 'marsh', 'jungle'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'permanent-ice', 'alpine-bare'],
    minMoisture: 0.30,
    maxMoisture: 0.96,
    minElevationMeters: -20,
    maxElevationMeters: 820,
    slopeLimitDegrees: 34,
    preferredSlopeDegrees: 12,
    roadAvoidanceMeters: 2.0,
    settlementBufferMeters: 36,
    shorelinePreference: 0.14,
    density: 0.74,
    cluster: 0.68,
    scaleMean: 1.02,
    scaleVariance: 0.18,
    rotationJitter: 0.22,
    coldPenalty: 0.42,
    dryPenalty: 0.26,
  }),
  birch: Object.freeze({
    id: 'birch',
    kind: 'vegetation',
    preferredBiomes: ['cold-grassland', 'temperate', 'mountain-foothill', 'coast'],
    toleratedBiomes: ['grassland', 'steppe'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'permanent-ice', 'desert'],
    minMoisture: 0.36,
    maxMoisture: 0.90,
    minElevationMeters: 120,
    maxElevationMeters: 1180,
    slopeLimitDegrees: 30,
    preferredSlopeDegrees: 11,
    roadAvoidanceMeters: 2.2,
    settlementBufferMeters: 44,
    shorelinePreference: 0.08,
    density: 0.54,
    cluster: 0.71,
    scaleMean: 0.97,
    scaleVariance: 0.15,
    rotationJitter: 0.20,
    coldPenalty: 0.12,
    dryPenalty: 0.22,
  }),
  pine: Object.freeze({
    id: 'pine',
    kind: 'vegetation',
    preferredBiomes: ['cold-grassland', 'mountain-foothill', 'alpine-transition', 'temperate'],
    toleratedBiomes: ['rocky-hills', 'steppe'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'permanent-ice', 'desert'],
    minMoisture: 0.22,
    maxMoisture: 0.88,
    minElevationMeters: 260,
    maxElevationMeters: 1880,
    slopeLimitDegrees: 36,
    preferredSlopeDegrees: 18,
    roadAvoidanceMeters: 2.5,
    settlementBufferMeters: 48,
    shorelinePreference: 0.03,
    density: 0.61,
    cluster: 0.74,
    scaleMean: 1.03,
    scaleVariance: 0.19,
    rotationJitter: 0.24,
    coldPenalty: 0.06,
    dryPenalty: 0.19,
  }),
  snowpine: Object.freeze({
    id: 'snowpine',
    kind: 'vegetation',
    preferredBiomes: ['snow', 'cold-grassland', 'alpine-transition'],
    toleratedBiomes: ['mountain-foothill'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'desert', 'jungle'],
    minMoisture: 0.18,
    maxMoisture: 0.82,
    minElevationMeters: 520,
    maxElevationMeters: 2480,
    slopeLimitDegrees: 38,
    preferredSlopeDegrees: 20,
    roadAvoidanceMeters: 3,
    settlementBufferMeters: 62,
    shorelinePreference: 0,
    density: 0.43,
    cluster: 0.82,
    scaleMean: 0.95,
    scaleVariance: 0.16,
    rotationJitter: 0.18,
    coldPenalty: 0.01,
    dryPenalty: 0.32,
  }),
  marshreed: Object.freeze({
    id: 'marshreed',
    kind: 'vegetation',
    preferredBiomes: ['marsh', 'wet-lowland', 'riverbank'],
    toleratedBiomes: ['coast', 'lush-lowland'],
    forbiddenBiomes: ['ocean', 'lake', 'permanent-ice', 'desert', 'alpine-bare'],
    minMoisture: 0.68,
    maxMoisture: 1.0,
    minElevationMeters: -40,
    maxElevationMeters: 360,
    slopeLimitDegrees: 18,
    preferredSlopeDegrees: 3,
    roadAvoidanceMeters: 3.5,
    settlementBufferMeters: 24,
    shorelinePreference: 0.18,
    density: 0.66,
    cluster: 0.88,
    scaleMean: 0.91,
    scaleVariance: 0.13,
    rotationJitter: 0.31,
    coldPenalty: 0.20,
    dryPenalty: 0.58,
  }),
  shrub: Object.freeze({
    id: 'shrub',
    kind: 'vegetation',
    preferredBiomes: ['steppe', 'arid-steppe', 'temperate', 'coast'],
    toleratedBiomes: ['dry-heath', 'rocky-hills', 'desert-edge'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'permanent-ice', 'jungle'],
    minMoisture: 0.12,
    maxMoisture: 0.76,
    minElevationMeters: -20,
    maxElevationMeters: 1420,
    slopeLimitDegrees: 48,
    preferredSlopeDegrees: 20,
    roadAvoidanceMeters: 1.8,
    settlementBufferMeters: 18,
    shorelinePreference: 0.12,
    density: 0.58,
    cluster: 0.55,
    scaleMean: 0.78,
    scaleVariance: 0.22,
    rotationJitter: 0.38,
    coldPenalty: 0.58,
    dryPenalty: 0.12,
  }),
  desertgrass: Object.freeze({
    id: 'desertgrass',
    kind: 'vegetation',
    preferredBiomes: ['desert', 'arid-basin', 'arid-steppe'],
    toleratedBiomes: ['steppe', 'coast'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice', 'jungle'],
    minMoisture: 0.02,
    maxMoisture: 0.42,
    minElevationMeters: -120,
    maxElevationMeters: 980,
    slopeLimitDegrees: 32,
    preferredSlopeDegrees: 8,
    roadAvoidanceMeters: 1.4,
    settlementBufferMeters: 20,
    shorelinePreference: 0.04,
    density: 0.39,
    cluster: 0.41,
    scaleMean: 0.73,
    scaleVariance: 0.20,
    rotationJitter: 0.46,
    coldPenalty: 0.77,
    dryPenalty: 0.03,
  }),
  junglevine: Object.freeze({
    id: 'junglevine',
    kind: 'vegetation',
    preferredBiomes: ['jungle', 'lush-lowland', 'wet-lowland'],
    toleratedBiomes: ['coast', 'marsh'],
    forbiddenBiomes: ['ocean', 'lake', 'permanent-ice', 'desert', 'steppe'],
    minMoisture: 0.70,
    maxMoisture: 1.0,
    minElevationMeters: -10,
    maxElevationMeters: 720,
    slopeLimitDegrees: 42,
    preferredSlopeDegrees: 16,
    roadAvoidanceMeters: 1.5,
    settlementBufferMeters: 30,
    shorelinePreference: 0.08,
    density: 0.78,
    cluster: 0.92,
    scaleMean: 0.86,
    scaleVariance: 0.24,
    rotationJitter: 0.55,
    coldPenalty: 0.88,
    dryPenalty: 0.82,
  }),
  meadowgrass: Object.freeze({
    id: 'meadowgrass',
    kind: 'groundcover',
    preferredBiomes: ['grassland', 'temperate', 'lush-lowland', 'coast'],
    toleratedBiomes: ['steppe', 'cold-grassland'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'permanent-ice', 'desert'],
    minMoisture: 0.28,
    maxMoisture: 0.86,
    minElevationMeters: -40,
    maxElevationMeters: 1220,
    slopeLimitDegrees: 28,
    preferredSlopeDegrees: 7,
    roadAvoidanceMeters: 0.8,
    settlementBufferMeters: 8,
    shorelinePreference: 0.09,
    density: 0.82,
    cluster: 0.60,
    scaleMean: 0.69,
    scaleVariance: 0.18,
    rotationJitter: 0.63,
    coldPenalty: 0.22,
    dryPenalty: 0.28,
  }),
  fern: Object.freeze({
    id: 'fern',
    kind: 'groundcover',
    preferredBiomes: ['temperate', 'lush-lowland', 'forest-understory'],
    toleratedBiomes: ['marsh', 'jungle', 'coast'],
    forbiddenBiomes: ['ocean', 'lake', 'permanent-ice', 'desert', 'arid-basin'],
    minMoisture: 0.52,
    maxMoisture: 0.98,
    minElevationMeters: -30,
    maxElevationMeters: 980,
    slopeLimitDegrees: 40,
    preferredSlopeDegrees: 13,
    roadAvoidanceMeters: 1.1,
    settlementBufferMeters: 14,
    shorelinePreference: 0.06,
    density: 0.69,
    cluster: 0.79,
    scaleMean: 0.73,
    scaleVariance: 0.17,
    rotationJitter: 0.57,
    coldPenalty: 0.42,
    dryPenalty: 0.61,
  }),
  granite: Object.freeze({
    id: 'granite',
    kind: 'geology',
    preferredBiomes: ['mountain-foothill', 'rocky-hills', 'alpine-transition'],
    toleratedBiomes: ['temperate', 'cold-grassland', 'steppe'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh'],
    minMoisture: 0.05,
    maxMoisture: 0.92,
    minElevationMeters: 180,
    maxElevationMeters: 2800,
    slopeLimitDegrees: 76,
    preferredSlopeDegrees: 38,
    roadAvoidanceMeters: 0.5,
    settlementBufferMeters: 28,
    shorelinePreference: 0.0,
    density: 0.49,
    cluster: 0.66,
    scaleMean: 1.05,
    scaleVariance: 0.27,
    rotationJitter: 0.18,
    coldPenalty: 0.08,
    dryPenalty: 0.07,
  }),
  basalt: Object.freeze({
    id: 'basalt',
    kind: 'geology',
    preferredBiomes: ['volcanic', 'valyria', 'basaltic-highland'],
    toleratedBiomes: ['rocky-hills', 'arid-basin', 'desert'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice'],
    minMoisture: 0.03,
    maxMoisture: 0.84,
    minElevationMeters: 40,
    maxElevationMeters: 2480,
    slopeLimitDegrees: 84,
    preferredSlopeDegrees: 46,
    roadAvoidanceMeters: 0.4,
    settlementBufferMeters: 35,
    shorelinePreference: 0.02,
    density: 0.57,
    cluster: 0.84,
    scaleMean: 1.10,
    scaleVariance: 0.25,
    rotationJitter: 0.16,
    coldPenalty: 0.12,
    dryPenalty: 0.06,
  }),
  limestone: Object.freeze({
    id: 'limestone',
    kind: 'geology',
    preferredBiomes: ['dry-hills', 'coast', 'temperate', 'arid-basin'],
    toleratedBiomes: ['rocky-hills', 'steppe'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice'],
    minMoisture: 0.05,
    maxMoisture: 0.72,
    minElevationMeters: 20,
    maxElevationMeters: 1680,
    slopeLimitDegrees: 76,
    preferredSlopeDegrees: 31,
    roadAvoidanceMeters: 0.7,
    settlementBufferMeters: 24,
    shorelinePreference: 0.15,
    density: 0.42,
    cluster: 0.62,
    scaleMean: 1.02,
    scaleVariance: 0.22,
    rotationJitter: 0.22,
    coldPenalty: 0.35,
    dryPenalty: 0.08,
  }),
  sandstone: Object.freeze({
    id: 'sandstone',
    kind: 'geology',
    preferredBiomes: ['desert', 'arid-basin', 'dry-steppe', 'coast'],
    toleratedBiomes: ['steppe', 'dry-hills'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice', 'jungle'],
    minMoisture: 0.01,
    maxMoisture: 0.48,
    minElevationMeters: -100,
    maxElevationMeters: 1340,
    slopeLimitDegrees: 70,
    preferredSlopeDegrees: 26,
    roadAvoidanceMeters: 0.6,
    settlementBufferMeters: 20,
    shorelinePreference: 0.08,
    density: 0.47,
    cluster: 0.74,
    scaleMean: 1.00,
    scaleVariance: 0.24,
    rotationJitter: 0.20,
    coldPenalty: 0.62,
    dryPenalty: 0.04,
  }),
  wetboulder: Object.freeze({
    id: 'wetboulder',
    kind: 'geology',
    preferredBiomes: ['marsh', 'riverbank', 'wet-lowland', 'coast'],
    toleratedBiomes: ['temperate', 'lush-lowland'],
    forbiddenBiomes: ['ocean', 'permanent-ice', 'desert', 'arid-basin'],
    minMoisture: 0.54,
    maxMoisture: 1.0,
    minElevationMeters: -50,
    maxElevationMeters: 620,
    slopeLimitDegrees: 54,
    preferredSlopeDegrees: 19,
    roadAvoidanceMeters: 1.2,
    settlementBufferMeters: 22,
    shorelinePreference: 0.25,
    density: 0.37,
    cluster: 0.83,
    scaleMean: 0.88,
    scaleVariance: 0.31,
    rotationJitter: 0.35,
    coldPenalty: 0.28,
    dryPenalty: 0.74,
  }),
  weatheredstone: Object.freeze({
    id: 'weatheredstone',
    kind: 'geology',
    preferredBiomes: ['temperate', 'grassland', 'coast', 'steppe'],
    toleratedBiomes: ['rocky-hills', 'dry-hills', 'cold-grassland'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'permanent-ice', 'jungle'],
    minMoisture: 0.12,
    maxMoisture: 0.80,
    minElevationMeters: -20,
    maxElevationMeters: 1500,
    slopeLimitDegrees: 70,
    preferredSlopeDegrees: 24,
    roadAvoidanceMeters: 0.9,
    settlementBufferMeters: 14,
    shorelinePreference: 0.18,
    density: 0.33,
    cluster: 0.54,
    scaleMean: 0.82,
    scaleVariance: 0.25,
    rotationJitter: 0.42,
    coldPenalty: 0.24,
    dryPenalty: 0.19,
  }),
  ruinwall: Object.freeze({
    id: 'ruinwall',
    kind: 'architecture',
    preferredBiomes: ['temperate', 'dry-hills', 'desert-edge', 'coast'],
    toleratedBiomes: ['steppe', 'arid-basin', 'rocky-hills'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice', 'jungle'],
    minMoisture: 0.05,
    maxMoisture: 0.70,
    minElevationMeters: -20,
    maxElevationMeters: 1200,
    slopeLimitDegrees: 18,
    preferredSlopeDegrees: 5,
    roadAvoidanceMeters: 4.0,
    settlementBufferMeters: 48,
    shorelinePreference: 0.06,
    density: 0.14,
    cluster: 0.32,
    scaleMean: 0.96,
    scaleVariance: 0.13,
    rotationJitter: 0.08,
    coldPenalty: 0.50,
    dryPenalty: 0.10,
  }),
  waystone: Object.freeze({
    id: 'waystone',
    kind: 'roadside',
    preferredBiomes: ['temperate', 'steppe', 'coast', 'cold-grassland'],
    toleratedBiomes: ['desert', 'arid-steppe', 'dry-hills'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice', 'jungle'],
    minMoisture: 0.04,
    maxMoisture: 0.76,
    minElevationMeters: -20,
    maxElevationMeters: 1460,
    slopeLimitDegrees: 20,
    preferredSlopeDegrees: 5,
    roadAvoidanceMeters: 6.0,
    settlementBufferMeters: 86,
    shorelinePreference: 0.02,
    density: 0.08,
    cluster: 0.22,
    scaleMean: 1.00,
    scaleVariance: 0.10,
    rotationJitter: 0.12,
    coldPenalty: 0.40,
    dryPenalty: 0.09,
  }),
  timberfence: Object.freeze({
    id: 'timberfence',
    kind: 'architecture',
    preferredBiomes: ['temperate', 'grassland', 'cold-grassland', 'lush-lowland'],
    toleratedBiomes: ['steppe', 'coast'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice', 'desert'],
    minMoisture: 0.20,
    maxMoisture: 0.82,
    minElevationMeters: -20,
    maxElevationMeters: 1040,
    slopeLimitDegrees: 16,
    preferredSlopeDegrees: 4,
    roadAvoidanceMeters: 3.5,
    settlementBufferMeters: 26,
    shorelinePreference: 0.04,
    density: 0.22,
    cluster: 0.64,
    scaleMean: 0.98,
    scaleVariance: 0.12,
    rotationJitter: 0.06,
    coldPenalty: 0.29,
    dryPenalty: 0.24,
  }),
  marketstall: Object.freeze({
    id: 'marketstall',
    kind: 'architecture',
    preferredBiomes: ['settlement-core', 'temperate', 'coast', 'grassland'],
    toleratedBiomes: ['steppe', 'desert-edge', 'cold-grassland'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice', 'alpine-bare'],
    minMoisture: 0.12,
    maxMoisture: 0.84,
    minElevationMeters: -40,
    maxElevationMeters: 720,
    slopeLimitDegrees: 10,
    preferredSlopeDegrees: 3,
    roadAvoidanceMeters: 0,
    settlementBufferMeters: 0,
    shorelinePreference: 0.0,
    density: 0.18,
    cluster: 0.91,
    scaleMean: 0.94,
    scaleVariance: 0.08,
    rotationJitter: 0.03,
    coldPenalty: 0.45,
    dryPenalty: 0.18,
  }),
  watermill: Object.freeze({
    id: 'watermill',
    kind: 'utility',
    preferredBiomes: ['riverbank', 'wet-lowland', 'temperate'],
    toleratedBiomes: ['lush-lowland', 'coast'],
    forbiddenBiomes: ['ocean', 'lake', 'permanent-ice', 'desert', 'arid-basin'],
    minMoisture: 0.58,
    maxMoisture: 1.0,
    minElevationMeters: -30,
    maxElevationMeters: 360,
    slopeLimitDegrees: 14,
    preferredSlopeDegrees: 3,
    roadAvoidanceMeters: 1.0,
    settlementBufferMeters: 42,
    shorelinePreference: 0.56,
    density: 0.06,
    cluster: 0.76,
    scaleMean: 1.08,
    scaleVariance: 0.11,
    rotationJitter: 0.04,
    coldPenalty: 0.35,
    dryPenalty: 0.86,
  }),
  dock: Object.freeze({
    id: 'dock',
    kind: 'utility',
    preferredBiomes: ['coast', 'lake-edge', 'riverbank'],
    toleratedBiomes: ['wet-lowland'],
    forbiddenBiomes: ['permanent-ice', 'desert', 'alpine-bare'],
    minMoisture: 0.72,
    maxMoisture: 1.0,
    minElevationMeters: -30,
    maxElevationMeters: 130,
    slopeLimitDegrees: 10,
    preferredSlopeDegrees: 2,
    roadAvoidanceMeters: 0,
    settlementBufferMeters: 54,
    shorelinePreference: 0.92,
    density: 0.07,
    cluster: 0.55,
    scaleMean: 1.06,
    scaleVariance: 0.09,
    rotationJitter: 0.05,
    coldPenalty: 0.62,
    dryPenalty: 0.90,
  }),
  cairn: Object.freeze({
    id: 'cairn',
    kind: 'landmark',
    preferredBiomes: ['alpine-transition', 'rocky-hills', 'steppe', 'cold-grassland'],
    toleratedBiomes: ['desert', 'arid-steppe', 'coast'],
    forbiddenBiomes: ['ocean', 'lake', 'marsh', 'jungle', 'wet-lowland'],
    minMoisture: 0.02,
    maxMoisture: 0.68,
    minElevationMeters: 420,
    maxElevationMeters: 2500,
    slopeLimitDegrees: 34,
    preferredSlopeDegrees: 14,
    roadAvoidanceMeters: 7,
    settlementBufferMeters: 180,
    shorelinePreference: 0.01,
    density: 0.045,
    cluster: 0.18,
    scaleMean: 0.89,
    scaleVariance: 0.16,
    rotationJitter: 0.15,
    coldPenalty: 0.08,
    dryPenalty: 0.11,
  }),
  ashrock: Object.freeze({
    id: 'ashrock',
    kind: 'geology',
    preferredBiomes: ['valyria', 'volcanic', 'ash-field'],
    toleratedBiomes: ['arid-basin', 'rocky-hills'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'permanent-ice', 'jungle'],
    minMoisture: 0.01,
    maxMoisture: 0.56,
    minElevationMeters: 0,
    maxElevationMeters: 2300,
    slopeLimitDegrees: 78,
    preferredSlopeDegrees: 35,
    roadAvoidanceMeters: 0.5,
    settlementBufferMeters: 40,
    shorelinePreference: 0.0,
    density: 0.63,
    cluster: 0.91,
    scaleMean: 0.99,
    scaleVariance: 0.28,
    rotationJitter: 0.25,
    coldPenalty: 0.42,
    dryPenalty: 0.03,
  }),
  driftwood: Object.freeze({
    id: 'driftwood',
    kind: 'landmark',
    preferredBiomes: ['coast', 'lake-edge', 'riverbank'],
    toleratedBiomes: ['wet-lowland', 'marsh'],
    forbiddenBiomes: ['permanent-ice', 'desert', 'alpine-bare'],
    minMoisture: 0.45,
    maxMoisture: 1.0,
    minElevationMeters: -30,
    maxElevationMeters: 220,
    slopeLimitDegrees: 22,
    preferredSlopeDegrees: 4,
    roadAvoidanceMeters: 2.8,
    settlementBufferMeters: 16,
    shorelinePreference: 0.72,
    density: 0.18,
    cluster: 0.64,
    scaleMean: 0.88,
    scaleVariance: 0.21,
    rotationJitter: 0.51,
    coldPenalty: 0.22,
    dryPenalty: 0.75,
  }),
  froststone: Object.freeze({
    id: 'froststone',
    kind: 'geology',
    preferredBiomes: ['snow', 'cold-grassland', 'alpine-transition'],
    toleratedBiomes: ['mountain-foothill'],
    forbiddenBiomes: ['ocean', 'lake', 'river', 'marsh', 'desert', 'jungle'],
    minMoisture: 0.08,
    maxMoisture: 0.74,
    minElevationMeters: 600,
    maxElevationMeters: 2550,
    slopeLimitDegrees: 72,
    preferredSlopeDegrees: 35,
    roadAvoidanceMeters: 0.6,
    settlementBufferMeters: 90,
    shorelinePreference: 0,
    density: 0.31,
    cluster: 0.78,
    scaleMean: 1.08,
    scaleVariance: 0.24,
    rotationJitter: 0.18,
    coldPenalty: 0.02,
    dryPenalty: 0.15,
  }),
});

const FAMILY_IDS = Object.freeze(Object.keys(GEOGRAPHIC_ASSET_FAMILY_PROFILES));

function hash32(value) {
  let x = Number(value) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

function hashString(value) {
  let hash = 2166136261 >>> 0;
  for (let i = 0; i < String(value).length; i += 1) {
    hash ^= String(value).charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash32(hash);
}

function hashWorld(worldX, worldZ, seed) {
  const x = Math.floor(Number(worldX) * 0.1) | 0;
  const z = Math.floor(Number(worldZ) * 0.1) | 0;
  return hash32(Math.imul(x ^ seed, 0x27d4eb2d) ^ Math.imul(z + seed, 0x165667b1));
}

function unitFromHash(hash) {
  return (hash >>> 0) / 4294967296;
}

function distanceToUnitBand(value, min, max, span = 1) {
  const x = Number(value);
  if (!Number.isFinite(x)) return 1;
  if (x >= min && x <= max) return 0;
  if (x < min) return clamp01((min - x) / Math.max(1, span));
  return clamp01((x - max) / Math.max(1, span));
}

function normalizeBiomeName(value) {
  return String(value || '').trim().toLowerCase().replace(/[_\s]+/g, '-');
}

function biomeMatch(profile, biome) {
  const name = normalizeBiomeName(biome);
  if (!name) return 0.35;
  if (profile.forbiddenBiomes.includes(name)) return 0;
  if (profile.preferredBiomes.includes(name)) return 1;
  if (profile.toleratedBiomes.includes(name)) return 0.63;
  if (name.includes('settlement') && profile.kind === 'architecture') return 0.72;
  if (name.includes('edge') && profile.toleratedBiomes.includes(name.replace('-edge', ''))) return 0.68;
  return 0.38;
}

function moistureMatch(profile, moisture) {
  const x = clamp01(moisture);
  if (x >= profile.minMoisture && x <= profile.maxMoisture) return 1;
  const span = Math.max(0.08, profile.maxMoisture - profile.minMoisture);
  return 1 - distanceToUnitBand(x, profile.minMoisture, profile.maxMoisture, span);
}

function elevationMatch(profile, elevation) {
  if (!Number.isFinite(Number(elevation))) return 0.5;
  const span = Math.max(80, profile.maxElevationMeters - profile.minElevationMeters);
  return 1 - distanceToUnitBand(Number(elevation), profile.minElevationMeters, profile.maxElevationMeters, span);
}

function slopeMatch(profile, slopeDegrees) {
  const slope = Math.max(0, Number(slopeDegrees) || 0);
  if (slope > profile.slopeLimitDegrees) return 0;
  const preferred = Math.max(0.5, profile.preferredSlopeDegrees);
  const difference = Math.abs(slope - preferred);
  return clamp01(1 - difference / Math.max(4, profile.slopeLimitDegrees));
}

function distancePenalty(distanceMeters, scaleMeters) {
  if (!Number.isFinite(Number(distanceMeters))) return 0;
  return smoothstep(0, Math.max(1, scaleMeters), Number(distanceMeters));
}

function shoreMatch(profile, shorelineDistance, isWater) {
  if (isWater) return profile.kind === 'utility' ? 0.42 : 0;
  if (!Number.isFinite(Number(shorelineDistance))) return 0.42;
  const d = Math.max(0, Number(shorelineDistance));
  const preference = clamp01(profile.shorelinePreference);
  const proximity = 1 - smoothstep(0, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.shoreInfluenceMaxMeters, d);
  return clamp01(0.38 + preference * proximity * 0.62);
}

function cryosphereMatch(profile, cryosphere = {}) {
  const permanentIce = clamp01(cryosphere.permanentIce);
  const tundra = clamp01(cryosphere.tundra);
  const snow = clamp01(cryosphere.snowPersistence ?? cryosphere.persistence);
  if (permanentIce >= 0.82 && !['vegetation', 'geology'].includes(profile.kind)) return 0.18;
  const coldPenalty = clamp01(profile.coldPenalty);
  const coldExposure = clamp01(permanentIce * 0.78 + tundra * 0.48 + snow * 0.32);
  return clamp01(1 - coldPenalty * coldExposure);
}

function dryMatch(profile, moisture) {
  const dry = 1 - clamp01(moisture);
  return clamp01(1 - clamp01(profile.dryPenalty) * dry);
}

function roadMatch(profile, roadDistanceMeters, roadContext = {}) {
  const d = Math.max(0, Number(roadDistanceMeters) || Infinity);
  const active = Number.isFinite(d);
  if (!active) return 0.58;
  const preferredAway = profile.roadAvoidanceMeters;
  if (preferredAway === 0) return 1;
  if (d < preferredAway) return 0.12;
  const corridor = clamp01(roadContext.corridorStrength ?? 0);
  const distance = smoothstep(preferredAway, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.roadInfluenceMaxMeters, d);
  return clamp01(lerp(distance, 0.78, corridor * 0.62));
}

function settlementMatch(profile, settlementDistanceMeters, settlementContext = {}) {
  const d = Math.max(0, Number(settlementDistanceMeters) || Infinity);
  if (!Number.isFinite(d)) return 0.66;
  const core = smoothstep(0, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.settlementInfluenceMaxMeters, d);
  if (profile.settlementBufferMeters > d) return profile.kind === 'architecture' ? 0.55 : 0.16;
  const proximity = 1 - core;
  const serviceAffinity = clamp01(settlementContext.serviceAffinity ?? 0);
  return clamp01(0.62 + serviceAffinity * proximity * 0.34 + core * 0.24);
}

function waterMatch(profile, waterDepth) {
  const depth = Math.max(0, Number(waterDepth) || 0);
  if (depth <= 0.02) return 1;
  if (profile.kind === 'utility' && profile.shorelinePreference > 0.5) return clamp01(1 - depth * 0.18);
  return clamp01(1 - smoothstep(0.02, 1.5, depth));
}

function reliefMatch(profile, localRelief) {
  if (!Number.isFinite(Number(localRelief))) return 0.6;
  const relief = clamp01(Number(localRelief));
  const target = profile.kind === 'geology' ? 0.72 : profile.kind === 'architecture' ? 0.22 : 0.48;
  return clamp01(1 - Math.abs(relief - target) * 1.55);
}

function seasonalMatch(profile, season = {}) {
  const spring = clamp01(season.spring);
  const summer = clamp01(season.summer);
  const autumn = clamp01(season.autumn);
  const winter = clamp01(season.winter);
  if (winter > 0.72 && profile.id === 'junglevine') return 0.24;
  if (summer > 0.76 && profile.id === 'froststone') return 0.72;
  if (autumn > 0.70 && profile.kind === 'vegetation') return 0.94;
  if (spring > 0.72 && profile.kind === 'groundcover') return 1;
  return 0.82;
}

function canonicalSurfaceRead(context = {}) {
  const biome = normalizeBiomeName(context.biome);
  const moisture = clamp01(context.moisture ?? context.moisture01);
  const slope = Math.max(0, Number(context.slopeDegrees ?? context.slope) || 0);
  const elevation = Number(context.elevationMeters ?? context.elevation);
  const waterDepth = Math.max(0, Number(context.waterDepth) || 0);
  const shorelineDistance = Number(context.shorelineDistanceMeters ?? context.shorelineDistance);
  const roadDistance = Number(context.roadDistanceMeters ?? context.roadDistance);
  const settlementDistance = Number(context.settlementDistanceMeters ?? context.settlementDistance);
  const localRelief = clamp01(context.localRelief ?? context.relief01 ?? 0.5);
  const isWater = Boolean(context.isWater || context.waterBody);
  return Object.freeze({
    biome,
    moisture,
    slope,
    elevation: Number.isFinite(elevation) ? elevation : 0,
    waterDepth,
    shorelineDistance: Number.isFinite(shorelineDistance) ? Math.max(0, shorelineDistance) : null,
    roadDistance: Number.isFinite(roadDistance) ? Math.max(0, roadDistance) : null,
    settlementDistance: Number.isFinite(settlementDistance) ? Math.max(0, settlementDistance) : null,
    localRelief,
    isWater,
  });
}

export function validateGeographicAssetContextInput(context) {
  const surface = canonicalSurfaceRead(context);
  const errors = [];
  if (!surface.biome) errors.push('missing-biome');
  if (!Number.isFinite(surface.moisture) || surface.moisture < 0 || surface.moisture > 1) errors.push('invalid-moisture');
  if (!Number.isFinite(surface.slope) || surface.slope < 0) errors.push('invalid-slope');
  if (!Number.isFinite(surface.elevation)) errors.push('invalid-elevation');
  if (!Number.isFinite(surface.waterDepth) || surface.waterDepth < 0) errors.push('invalid-water-depth');
  if (surface.shorelineDistance !== null && surface.shorelineDistance < 0) errors.push('invalid-shoreline-distance');
  if (surface.roadDistance !== null && surface.roadDistance < 0) errors.push('invalid-road-distance');
  if (surface.settlementDistance !== null && surface.settlementDistance < 0) errors.push('invalid-settlement-distance');
  return Object.freeze({ ok: errors.length === 0, errors, surface });
}

export function scoreGeographicAssetFamily(familyId, context = {}) {
  const profile = GEOGRAPHIC_ASSET_FAMILY_PROFILES[familyId];
  if (!profile) return Object.freeze({ ok: false, familyId, error: 'unknown-family' });
  const surface = canonicalSurfaceRead(context);
  const validation = validateGeographicAssetContextInput(context);
  if (!validation.ok) return Object.freeze({ ok: false, familyId, error: validation.errors.join(','), profile, surface });

  const terms = {
    biome: biomeMatch(profile, surface.biome),
    moisture: moistureMatch(profile, surface.moisture),
    elevation: elevationMatch(profile, surface.elevation),
    slope: slopeMatch(profile, surface.slope),
    shore: shoreMatch(profile, surface.shorelineDistance, surface.isWater),
    road: roadMatch(profile, surface.roadDistance, context.roadContext),
    settlement: settlementMatch(profile, surface.settlementDistance, context.settlementContext),
    water: waterMatch(profile, surface.waterDepth),
    relief: reliefMatch(profile, surface.localRelief),
    cryosphere: cryosphereMatch(profile, context.cryosphere),
    dry: dryMatch(profile, surface.moisture),
    season: seasonalMatch(profile, context.season),
  };

  const hardReject =
    terms.biome === 0 ||
    terms.slope === 0 ||
    terms.water === 0 ||
    (surface.isWater && profile.kind !== 'utility') ||
    (Number.isFinite(surface.settlementDistance) && surface.settlementDistance < profile.settlementBufferMeters * 0.55 && profile.kind === 'vegetation');

  const weights = {
    biome: 0.20,
    moisture: 0.12,
    elevation: 0.09,
    slope: 0.09,
    shore: 0.08,
    road: 0.08,
    settlement: 0.06,
    water: 0.08,
    relief: 0.05,
    cryosphere: 0.07,
    dry: 0.04,
    season: 0.04,
  };

  let weighted = 0;
  let weightSum = 0;
  for (const [key, weight] of Object.entries(weights)) {
    weighted += terms[key] * weight;
    weightSum += weight;
  }
  const score = hardReject ? 0 : clamp01(weighted / weightSum);
  return Object.freeze({
    ok: true,
    familyId,
    kind: profile.kind,
    score,
    accepted: score >= 0.34,
    hardReject,
    terms: Object.freeze(terms),
    weights: Object.freeze(weights),
    profile,
    surface,
  });
}

export function rankGeographicAssetFamilies(familyIds, context = {}) {
  const ids = Array.isArray(familyIds) && familyIds.length ? familyIds : FAMILY_IDS;
  const scored = ids.map((familyId) => scoreGeographicAssetFamily(familyId, context));
  scored.sort((a, b) => (b.score || 0) - (a.score || 0) || String(a.familyId).localeCompare(String(b.familyId)));
  return Object.freeze(scored);
}

export function selectGeographicAssetFamily({ familyIds, context = {}, worldX = 0, worldZ = 0, seed = 0, minimumScore = 0.34 } = {}) {
  const ranked = rankGeographicAssetFamilies(familyIds, context);
  const candidates = ranked.filter((item) => item.ok && item.accepted && item.score >= minimumScore);
  if (!candidates.length) return Object.freeze({ ok: false, familyId: null, candidates: ranked, reason: 'no-suitable-family' });
  const topScore = candidates[0].score;
  const contenders = candidates.filter((item) => item.score >= topScore - 0.10);
  const hash = hashWorld(worldX, worldZ, GEOGRAPHIC_ASSET_CONTEXT_POLICY.seeds.selection ^ hashString(seed));
  const index = hash % contenders.length;
  const selected = contenders[index];
  return Object.freeze({
    ok: true,
    familyId: selected.familyId,
    score: selected.score,
    selected,
    contenders,
    candidates,
    digest: hash,
  });
}

export function deriveGeographicAssetVariant({ familyId, context = {}, worldX = 0, worldZ = 0, seed = 0 } = {}) {
  const selection = selectGeographicAssetFamily({ familyIds: [familyId], context, worldX, worldZ, seed, minimumScore: 0 });
  if (!selection.ok || !selection.selected) return Object.freeze({ ok: false, familyId, variant: 'fallback' });
  const base = hashWorld(worldX, worldZ, GEOGRAPHIC_ASSET_CONTEXT_POLICY.seeds.patch ^ hashString(`${seed}|${familyId}`));
  const moisture = clamp01(context.moisture ?? context.moisture01);
  const cryo = clamp01(context.cryosphere?.snowPersistence ?? context.cryosphere?.persistence);
  const region = normalizeBiomeName(context.biome);
  const season = context.season || {};
  const wet = moisture > 0.72;
  const cold = clamp01((context.cryosphere?.permanentIce ?? 0) * 0.75 + (context.cryosphere?.tundra ?? 0) * 0.25) > 0.52;
  const variantIndex = (base ^ Math.floor(cryo * 17) ^ Math.floor((season.autumn || 0) * 13)) % 7;
  const familyVariant = wet && familyId !== 'desertgrass' ? 'wet' : cold ? 'cold' : region.includes('arid') || region.includes('desert') ? 'dry' : 'standard';
  return Object.freeze({
    ok: true,
    familyId,
    variant: `${familyId}-${familyVariant}-${variantIndex}`,
    weatheringBand: familyVariant,
    variantIndex,
    digest: base,
  });
}

export function deriveGeographicAssetPlacement({ familyId, context = {}, worldX = 0, worldZ = 0, seed = 0 } = {}) {
  const profile = GEOGRAPHIC_ASSET_FAMILY_PROFILES[familyId];
  if (!profile) return Object.freeze({ ok: false, error: 'unknown-family', familyId });
  const score = scoreGeographicAssetFamily(familyId, context);
  if (!score.ok) return Object.freeze({ ok: false, error: score.error, familyId });
  const baseSeed = hashString(`${seed}|${familyId}`);
  const scaleHash = hashWorld(worldX, worldZ, GEOGRAPHIC_ASSET_CONTEXT_POLICY.seeds.scale ^ baseSeed);
  const rotationHash = hashWorld(worldX, worldZ, GEOGRAPHIC_ASSET_CONTEXT_POLICY.seeds.rotation ^ baseSeed);
  const patchHash = hashWorld(worldX, worldZ, GEOGRAPHIC_ASSET_CONTEXT_POLICY.seeds.patch ^ baseSeed);
  const densityHash = hashWorld(worldX, worldZ, GEOGRAPHIC_ASSET_CONTEXT_POLICY.seeds.density ^ baseSeed);
  const clusterHash = hashWorld(worldX, worldZ, GEOGRAPHIC_ASSET_CONTEXT_POLICY.seeds.cluster ^ baseSeed);

  const localScale = lerp(profile.scaleMean - profile.scaleVariance, profile.scaleMean + profile.scaleVariance, unitFromHash(scaleHash));
  const size = clamp(localScale, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMin, GEOGRAPHIC_ASSET_CONTEXT_POLICY.bounds.scaleMax);
  const angle = (unitFromHash(rotationHash) - 0.5) * Math.PI * profile.rotationJitter;
  const patch = unitFromHash(patchHash);
  const densityNoise = lerp(0.72, 1.28, unitFromHash(densityHash));
  const clusterNoise = unitFromHash(clusterHash);
  const suitability = clamp01(score.score);
  const climateSuppression = clamp01(context.cryosphere?.vegetationSuppression ?? 0);
  const moistureBoost = profile.minMoisture > 0.5 ? lerp(0.85, 1.18, clamp01(context.moisture ?? context.moisture01)) : 1;
  const settlementPressure = Number.isFinite(Number(context.settlementDistanceMeters ?? context.settlementDistance))
    ? 1 - smoothstep(0, 170, Number(context.settlementDistanceMeters ?? context.settlementDistance))
    : 0;
  const vegetationSuppression = profile.kind === 'vegetation' ? (1 - climateSuppression * 0.72) : 1;
  const density = clamp01(profile.density * suitability * densityNoise * moistureBoost * vegetationSuppression * (1 - settlementPressure * (profile.kind === 'vegetation' ? 0.48 : 0.18)));
  const cluster = clamp01(profile.cluster * (0.72 + clusterNoise * 0.56) * (0.72 + patch * 0.28));

  return Object.freeze({
    ok: !score.hardReject,
    familyId,
    kind: profile.kind,
    suitability,
    density,
    cluster,
    scale: size,
    rotationBiasRadians: angle,
    microPatch: patch,
    digest: hash32(scaleHash ^ rotationHash ^ patchHash ^ densityHash ^ clusterHash),
    reasons: Object.freeze({
      biome: score.terms.biome,
      moisture: score.terms.moisture,
      elevation: score.terms.elevation,
      slope: score.terms.slope,
      shore: score.terms.shore,
      road: score.terms.road,
      settlement: score.terms.settlement,
      water: score.terms.water,
      relief: score.terms.relief,
      cryosphere: score.terms.cryosphere,
      season: score.terms.season,
    }),
  });
}

export function buildGeographicAssetContext({
  familyIds = FAMILY_IDS,
  worldX = 0,
  worldZ = 0,
  seed = 0,
  context = {},
  maxFamilies = 6,
} = {}) {
  const validation = validateGeographicAssetContextInput(context);
  if (!validation.ok) return Object.freeze({ ok: false, errors: validation.errors, context: null, rankings: [] });
  const ranked = rankGeographicAssetFamilies(familyIds, context);
  const picked = selectGeographicAssetFamily({ familyIds, context, worldX, worldZ, seed });
  const accepted = ranked.filter((item) => item.ok && item.accepted).slice(0, Math.max(1, Number(maxFamilies) || 6));
  const placementProfiles = accepted.map((item) => deriveGeographicAssetPlacement({ familyId: item.familyId, context, worldX, worldZ, seed }));
  const variant = picked.ok
    ? deriveGeographicAssetVariant({ familyId: picked.familyId, context, worldX, worldZ, seed })
    : Object.freeze({ ok: false, variant: 'none' });

  const densityField = accepted.length
    ? accepted.reduce((sum, item) => sum + item.score, 0) / accepted.length
    : 0;
  const habitatPressure = clamp01(1 - densityField);
  const canonicalClimate = Object.freeze({
    permanentIce: clamp01(context.cryosphere?.permanentIce),
    tundra: clamp01(context.cryosphere?.tundra),
    snowPersistence: clamp01(context.cryosphere?.snowPersistence ?? context.cryosphere?.persistence),
    vegetationSuppression: clamp01(context.cryosphere?.vegetationSuppression),
  });

  return Object.freeze({
    ok: true,
    policyId: GEOGRAPHIC_ASSET_CONTEXT_POLICY.id,
    version: GEOGRAPHIC_ASSET_CONTEXT_POLICY.contextVersion,
    world: Object.freeze({ x: Number(worldX) || 0, z: Number(worldZ) || 0, seed: String(seed) }),
    surface: validation.surface,
    canonicalClimate,
    selectedFamily: picked.ok ? picked.familyId : null,
    selectedScore: picked.ok ? picked.score : 0,
    selectedVariant: variant.ok ? variant.variant : 'none',
    habitatPressure,
    densityField: clamp01(densityField),
    rankings: Object.freeze(ranked),
    acceptedFamilies: Object.freeze(accepted),
    placementProfiles: Object.freeze(placementProfiles),
    deterministicDigest: hash32(
      hashWorld(worldX, worldZ, hashString(seed)) ^
      hashString(validation.surface.biome) ^
      Math.floor(validation.surface.moisture * 1000),
    ),
  });
}

export function geographicAssetContextAtWorldXZ(worldX, worldZ, options = {}) {
  if (!Number.isFinite(worldX) || !Number.isFinite(worldZ)) {
    throw new TypeError('geographic asset context world coordinates must be finite');
  }
  return buildGeographicAssetContext({ ...options, worldX, worldZ });
}

export function replayGeographicAssetContext(samples = []) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  return samples.map((sample) => buildGeographicAssetContext(sample));
}

export function geographicAssetContextDigest(context) {
  if (!context || typeof context !== 'object') return 0;
  const base = hashString(`${context.policyId || ''}|${context.selectedFamily || ''}|${context.selectedVariant || ''}`);
  const world = hashWorld(context.world?.x ?? 0, context.world?.z ?? 0, base);
  const surface = hashString(`${context.surface?.biome || ''}|${context.surface?.moisture || 0}|${context.surface?.slope || 0}`);
  return hash32(world ^ surface ^ Number(context.deterministicDigest || 0));
}

export function assertGeographicAssetContextDeterminism({ samples = [], familyIds = FAMILY_IDS } = {}) {
  const defaultSamples = [
    { worldX: 0, worldZ: 0, seed: 'a', context: { biome: 'temperate', moisture: 0.54, slopeDegrees: 8, elevationMeters: 220 } },
    { worldX: 184, worldZ: -420, seed: 'b', context: { biome: 'cold-grassland', moisture: 0.46, slopeDegrees: 15, elevationMeters: 740, cryosphere: { tundra: 0.63, permanentIce: 0.0, snowPersistence: 0.72 } } },
    { worldX: -930, worldZ: 1180, seed: 'c', context: { biome: 'desert', moisture: 0.11, slopeDegrees: 18, elevationMeters: 410 } },
    { worldX: 1260, worldZ: 760, seed: 'd', context: { biome: 'marsh', moisture: 0.88, slopeDegrees: 4, elevationMeters: 46, waterDepth: 0.02, shorelineDistanceMeters: 80 } },
    { worldX: -2040, worldZ: -1500, seed: 'e', context: { biome: 'valyria', moisture: 0.18, slopeDegrees: 34, elevationMeters: 960 } },
  ];
  const source = samples.length ? samples : defaultSamples;
  const first = source.map((sample) => buildGeographicAssetContext({ ...sample, familyIds }));
  const second = source.map((sample) => buildGeographicAssetContext({ ...sample, familyIds }));
  const mismatches = [];
  for (let i = 0; i < first.length; i += 1) {
    const a = first[i];
    const b = second[i];
    if (JSON.stringify(a) !== JSON.stringify(b)) mismatches.push(i);
  }
  return Object.freeze({ ok: mismatches.length === 0, sampleCount: source.length, mismatches, digests: first.map(geographicAssetContextDigest) });
}

export function summarizeGeographicAssetContext(context) {
  if (!context?.ok) return Object.freeze({ ok: false, selectedFamily: null, acceptedFamilyCount: 0, densityField: 0 });
  return Object.freeze({
    ok: true,
    selectedFamily: context.selectedFamily,
    selectedVariant: context.selectedVariant,
    acceptedFamilyCount: context.acceptedFamilies?.length || 0,
    densityField: context.densityField,
    habitatPressure: context.habitatPressure,
    deterministicDigest: geographicAssetContextDigest(context),
  });
}

export const GEOGRAPHIC_ASSET_CONTEXT_FAMILY_IDS = FAMILY_IDS;

export const __TEST__ = Object.freeze({
  clamp01,
  clamp,
  lerp,
  smoothstep,
  hash32,
  hashString,
  hashWorld,
  biomeMatch,
  moistureMatch,
  elevationMatch,
  slopeMatch,
  distancePenalty,
  shoreMatch,
  cryosphereMatch,
  dryMatch,
  roadMatch,
  settlementMatch,
  waterMatch,
  reliefMatch,
  seasonalMatch,
  canonicalSurfaceRead,
});
