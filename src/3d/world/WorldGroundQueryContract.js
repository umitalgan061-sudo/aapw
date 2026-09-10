/**
 * Shared read-only ground query facade for terrain/environment consumers.
 *
 * This module does not place assets, create geometry, mutate canonical terrain, or import editor UI.
 * Callers provide already-authoritative samples from terrain/hydrology/collider/route systems.
 * The facade gives the other agents one deterministic answer for grounding, slope, water, biome and
 * placement eligibility without creating a second MaterialAssignmentCore/WorldAssetPlacementPipeline.
 */

const finite = (value, fallback = 0) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
};
const clamp01 = (value) => Math.max(0, Math.min(1, finite(value)));
const clamp = (value, min, max) => Math.max(min, Math.min(max, finite(value, min)));
const normalizeToken = (value, fallback = 'unknown') => {
  const token = String(value ?? '').trim().toLowerCase();
  return token || fallback;
};
const freeze = (value) => Object.freeze(value);

export const WORLD_GROUND_QUERY_CONTRACT = freeze({
  id: 'world-ground-query-contract-v47',
  version: 47,
  authority: 'caller-owned-canonical-samples',
  createsGeometry: false,
  mutatesCanonicalState: false,
  ownsPlacement: false,
  ownsMaterials: false,
  editorRuntimeImport: false,
  waterClasses: freeze(['none', 'river', 'lake', 'sea', 'wetland']),
  placementExclusions: freeze(['water', 'steep-slope', 'road', 'settlement', 'permanent-snow', 'low-confidence']),
});

function waterClass(value, depth, coverage) {
  const explicit = normalizeToken(value, 'none');
  if (WORLD_GROUND_QUERY_CONTRACT.waterClasses.includes(explicit)) return explicit;
  if (coverage <= 0.02 && depth <= 0.02) return 'none';
  if (depth > 8) return 'sea';
  if (depth > 2) return 'lake';
  return 'river';
}

function surfaceBand({ height, slope, moisture, snow }) {
  if (snow > 0.78 || height > 180) return 'alpine-snow';
  if (slope > 42) return 'cliff';
  if (moisture > 0.72) return 'wet-lowland';
  if (height < 8 && moisture > 0.48) return 'shore';
  if (slope > 24) return 'ridge';
  if (height < 35) return 'lowland';
  return 'upland';
}

function confidenceOf(sample) {
  const explicit = clamp01(sample.confidence ?? 1);
  const canonical = sample.canonicalHeightMeters !== undefined ? 1 : 0.65;
  const collider = sample.colliderHeightMeters !== undefined ? 1 : 0.65;
  const water = sample.waterClass !== undefined || sample.waterDepthMeters !== undefined ? 1 : 0.75;
  return clamp01(explicit * canonical * collider * water);
}

export function normalizeGroundSample(input = {}) {
  const sample = input && typeof input === 'object' ? input : {};
  const height = finite(sample.heightMeters ?? sample.renderedHeightMeters);
  const canonicalHeight = finite(sample.canonicalHeightMeters ?? height);
  const colliderHeight = finite(sample.colliderHeightMeters ?? canonicalHeight);
  const slope = clamp(finite(sample.slopeDegrees), 0, 90);
  const moisture = clamp01(sample.moisture);
  const snow = clamp01(sample.snow);
  const waterDepth = Math.max(0, finite(sample.waterDepthMeters));
  const waterCoverage = clamp01(sample.waterCoverage);
  const water = waterClass(sample.waterClass, waterDepth, waterCoverage);
  const biome = normalizeToken(sample.biome, 'unknown');
  const roadDistance = Math.max(0, finite(sample.roadDistanceMeters, Infinity));
  const settlementDistance = Math.max(0, finite(sample.settlementDistanceMeters, Infinity));
  const confidence = confidenceOf(sample);
  return freeze({
    x: finite(sample.x),
    z: finite(sample.z),
    heightMeters: height,
    canonicalHeightMeters: canonicalHeight,
    colliderHeightMeters: colliderHeight,
    parityDeltaMeters: Math.abs(canonicalHeight - colliderHeight),
    slopeDegrees: slope,
    moisture,
    snow,
    waterDepthMeters: waterDepth,
    waterCoverage,
    waterClass: water,
    biome,
    roadDistanceMeters: roadDistance,
    settlementDistanceMeters: settlementDistance,
    confidence,
    surfaceBand: surfaceBand({ height, slope, moisture, snow }),
  });
}

export function queryGroundContext(input = {}) {
  const sample = normalizeGroundSample(input);
  const waterBlocked = sample.waterClass !== 'none' || sample.waterCoverage > 0.08;
  const slopeBlocked = sample.slopeDegrees >= 38;
  const roadBlocked = sample.roadDistanceMeters < 3;
  const settlementBlocked = sample.settlementDistanceMeters < 8;
  const snowBlocked = sample.snow >= 0.82;
  const confidenceBlocked = sample.confidence < 0.55;
  const exclusions = freeze([
    ...(waterBlocked ? ['water'] : []),
    ...(slopeBlocked ? ['steep-slope'] : []),
    ...(roadBlocked ? ['road'] : []),
    ...(settlementBlocked ? ['settlement'] : []),
    ...(snowBlocked ? ['permanent-snow'] : []),
    ...(confidenceBlocked ? ['low-confidence'] : []),
  ]);
  return freeze({
    contractId: WORLD_GROUND_QUERY_CONTRACT.id,
    sample,
    grounded: exclusions.length === 0,
    exclusions,
    canQueryNav: confidenceBlocked === false,
    canQueryBiome: sample.biome !== 'unknown' && confidenceBlocked === false,
    canQueryWater: sample.waterClass !== 'none' || sample.waterDepthMeters > 0,
    canQuerySlope: confidenceBlocked === false,
    canQueryCollider: sample.parityDeltaMeters <= 0.5 && confidenceBlocked === false,
    recommendedGroundY: sample.colliderHeightMeters,
  });
}

export function queryGroundContextBatch(samples = []) {
  if (!Array.isArray(samples)) return freeze([]);
  return freeze(samples.map((sample) => queryGroundContext(sample)));
}

export function buildGroundQueryManifest(samples = []) {
  const entries = queryGroundContextBatch(samples);
  const summary = entries.reduce((acc, entry) => {
    acc.total += 1;
    if (entry.grounded) acc.grounded += 1;
    for (const reason of entry.exclusions) acc.exclusions[reason] = (acc.exclusions[reason] ?? 0) + 1;
    return acc;
  }, { total: 0, grounded: 0, exclusions: {} });
  return freeze({
    contract: WORLD_GROUND_QUERY_CONTRACT,
    entries,
    summary: freeze({
      total: summary.total,
      grounded: summary.grounded,
      groundedRatio: summary.total ? summary.grounded / summary.total : 0,
      exclusions: freeze({ ...summary.exclusions }),
    }),
  });
}
