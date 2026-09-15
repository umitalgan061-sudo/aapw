/**
 * Terrain relief + material adoption contract.
 *
 * This module is intentionally pure and DOM-free. It does not generate terrain,
 * mutate canonical height fields, attach scene nodes, or replace the shared
 * MaterialAssignmentCore / WorldAssetPlacementPipeline. The scene owner passes
 * already-resolved world samples and applies the returned bounded profile.
 */

const EPSILON = 1e-6;
const MIN_ROUGHNESS = 0.22;
const MAX_ROUGHNESS = 0.98;
const MIN_NORMAL_ENERGY = 0.04;
const MAX_NORMAL_ENERGY = 0.82;
const MAX_MACRO_CONTRAST = 0.42;
const MAX_MICRO_CONTRAST = 0.3;
const MAX_SURFACE_WEIGHT = 1;
const MIN_BAND_METERS = 0.5;
const MAX_BAND_METERS = 220;
const DEFAULT_SEED = 0x9e3779b9;

const SURFACES = Object.freeze([
  'grass',
  'soil',
  'mud',
  'sand',
  'rock',
  'scree',
  'snow',
  'wetEdge',
  'foam',
]);

const RELIEF_BANDS = Object.freeze([
  'lowland',
  'shore',
  'forestFloor',
  'ridge',
  'cliff',
  'alpine',
  'snowline',
]);

const DEFAULT_THRESHOLDS = Object.freeze({
  waterLevelMeters: 0,
  shorelineBandMeters: 14,
  wetEdgeBandMeters: 9,
  snowlineBandMeters: 75,
  alpineElevationMeters: 320,
  cliffSlopeDegrees: 42,
  ridgeSlopeDegrees: 24,
  screeSlopeDegrees: 31,
  forestMoistureThreshold: 0.36,
  hardSurfaceMoistureThreshold: 0.18,
  highConfidenceThreshold: 0.6,
});

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, finiteNumber(value, min)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function positiveOr(value, fallback) {
  const n = finiteNumber(value, fallback);
  return n > 0 ? n : fallback;
}

function hash32(value) {
  let x = value | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  return (x ^ (x >>> 16)) >>> 0;
}

function seededUnit(seed, x, z, salt = 0) {
  const sx = Math.round(finiteNumber(x, 0) * 1000);
  const sz = Math.round(finiteNumber(z, 0) * 1000);
  const mixed = hash32((seed | 0) ^ hash32(sx + 0x7f4a7c15) ^ hash32(sz + 0x6a09e667) ^ salt);
  return mixed / 0xffffffff;
}

function normalizeThresholds(input = {}) {
  const merged = { ...DEFAULT_THRESHOLDS, ...(input || {}) };
  return Object.freeze({
    waterLevelMeters: finiteNumber(merged.waterLevelMeters, DEFAULT_THRESHOLDS.waterLevelMeters),
    shorelineBandMeters: clamp(merged.shorelineBandMeters, MIN_BAND_METERS, MAX_BAND_METERS),
    wetEdgeBandMeters: clamp(merged.wetEdgeBandMeters, MIN_BAND_METERS, MAX_BAND_METERS),
    snowlineBandMeters: clamp(merged.snowlineBandMeters, MIN_BAND_METERS, MAX_BAND_METERS),
    alpineElevationMeters: finiteNumber(merged.alpineElevationMeters, DEFAULT_THRESHOLDS.alpineElevationMeters),
    cliffSlopeDegrees: clamp(merged.cliffSlopeDegrees, 20, 80),
    ridgeSlopeDegrees: clamp(merged.ridgeSlopeDegrees, 8, 65),
    screeSlopeDegrees: clamp(merged.screeSlopeDegrees, 15, 75),
    forestMoistureThreshold: clamp01(merged.forestMoistureThreshold),
    hardSurfaceMoistureThreshold: clamp01(merged.hardSurfaceMoistureThreshold),
    highConfidenceThreshold: clamp01(merged.highConfidenceThreshold),
  });
}

function normalizeSample(sample = {}, thresholds = DEFAULT_THRESHOLDS) {
  const point = sample.point || sample.position || {};
  const elevationMeters = finiteNumber(sample.elevationMeters ?? sample.heightMeters ?? point.y, 0);
  const slopeDegrees = clamp(sample.slopeDegrees ?? sample.slope ?? 0, 0, 90);
  const moisture = clamp01(sample.moisture ?? sample.moisture01 ?? 0.45);
  const waterDistanceMeters = Math.abs(finiteNumber(
    sample.waterDistanceMeters ?? sample.distanceToWaterMeters,
    Math.abs(elevationMeters - thresholds.waterLevelMeters),
  ));
  const waterDepthMeters = Math.max(0, finiteNumber(sample.waterDepthMeters ?? sample.depthMeters, 0));
  const biome = String(sample.biome || sample.biomeId || 'temperate').toLowerCase();
  const confidence = clamp01(sample.confidence ?? sample.sourceConfidence ?? 1);
  const roadDistanceMeters = Math.max(0, finiteNumber(sample.roadDistanceMeters, Number.POSITIVE_INFINITY));
  const settlementDistanceMeters = Math.max(0, finiteNumber(sample.settlementDistanceMeters, Number.POSITIVE_INFINITY));
  const x = finiteNumber(sample.x ?? point.x, 0);
  const z = finiteNumber(sample.z ?? point.z, 0);
  return Object.freeze({
    x,
    z,
    elevationMeters,
    slopeDegrees,
    moisture,
    waterDistanceMeters,
    waterDepthMeters,
    biome,
    confidence,
    roadDistanceMeters,
    settlementDistanceMeters,
    isCanonical: sample.isCanonical !== false,
    isRendered: sample.isRendered !== false,
    isCollider: sample.isCollider !== false,
  });
}

function smoothstep(edge0, edge1, value) {
  if (Math.abs(edge1 - edge0) <= EPSILON) return value >= edge1 ? 1 : 0;
  const t = clamp01((value - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

function inverseSmoothstep(edge0, edge1, value) {
  return 1 - smoothstep(edge0, edge1, value);
}

function normalizeWeights(weights) {
  const safe = {};
  let total = 0;
  for (const surface of SURFACES) {
    const weight = clamp01(weights?.[surface] ?? 0);
    safe[surface] = weight;
    total += weight;
  }
  if (total <= EPSILON) {
    safe.soil = 1;
    return Object.freeze(safe);
  }
  for (const surface of SURFACES) safe[surface] = clamp(safe[surface] / total, 0, MAX_SURFACE_WEIGHT);
  return Object.freeze(safe);
}

function deriveReliefBand(sample, thresholds) {
  if (sample.waterDepthMeters > 0.05 || sample.elevationMeters <= thresholds.waterLevelMeters + 0.25) return 'shore';
  if (sample.slopeDegrees >= thresholds.cliffSlopeDegrees) return 'cliff';
  if (sample.elevationMeters >= thresholds.alpineElevationMeters) {
    if (sample.waterDistanceMeters <= thresholds.snowlineBandMeters) return 'snowline';
    return 'alpine';
  }
  if (sample.slopeDegrees >= thresholds.ridgeSlopeDegrees) return 'ridge';
  if (sample.moisture >= thresholds.forestMoistureThreshold && sample.slopeDegrees < thresholds.screeSlopeDegrees) return 'forestFloor';
  return 'lowland';
}

function deriveBandWeights(sample, thresholds) {
  const shoreline = inverseSmoothstep(
    0,
    thresholds.shorelineBandMeters,
    sample.waterDistanceMeters,
  );
  const wetEdge = inverseSmoothstep(
    0,
    thresholds.wetEdgeBandMeters,
    sample.waterDistanceMeters,
  ) * (sample.waterDepthMeters <= 0 ? 1 : 0.65);
  const snowline = smoothstep(
    thresholds.alpineElevationMeters - thresholds.snowlineBandMeters,
    thresholds.alpineElevationMeters + thresholds.snowlineBandMeters,
    sample.elevationMeters,
  );
  const cliff = smoothstep(thresholds.cliffSlopeDegrees - 12, thresholds.cliffSlopeDegrees, sample.slopeDegrees);
  const ridge = smoothstep(thresholds.ridgeSlopeDegrees - 8, thresholds.ridgeSlopeDegrees + 10, sample.slopeDegrees);
  const alpine = smoothstep(thresholds.alpineElevationMeters - 75, thresholds.alpineElevationMeters + 100, sample.elevationMeters);
  return Object.freeze({
    shoreline: clamp01(shoreline),
    wetEdge: clamp01(wetEdge),
    snowline: clamp01(snowline),
    cliff: clamp01(cliff),
    ridge: clamp01(ridge),
    alpine: clamp01(alpine),
  });
}

function deriveSurfaceWeights(sample, thresholds, bands) {
  const dry = 1 - sample.moisture;
  const slopeHardness = smoothstep(12, 54, sample.slopeDegrees);
  const elevationCold = bands.alpine;
  const shore = bands.shoreline;
  const wet = bands.wetEdge;
  const snow = bands.snowline;
  const soil = (1 - slopeHardness) * (1 - snow) * (1 - shore * 0.8);
  const grass = (1 - slopeHardness) * (0.65 + sample.moisture * 0.55) * (1 - snow) * (1 - shore * 0.55);
  const mud = sample.moisture * (1 - slopeHardness * 0.55) * (1 - snow);
  const sand = (1 - sample.moisture) * shore * (sample.biome.includes('coast') || sample.biome.includes('desert') ? 1 : 0.55);
  const rock = slopeHardness * (0.55 + bands.cliff * 0.8) + elevationCold * 0.18;
  const scree = smoothstep(thresholds.screeSlopeDegrees - 5, thresholds.screeSlopeDegrees + 12, sample.slopeDegrees) * (0.35 + bands.ridge * 0.65) * (1 - snow);
  const snowSurface = snow * (0.55 + elevationCold * 0.4) * (1 - shore * 0.45);
  const wetEdge = wet * (0.3 + sample.moisture * 0.7) * (1 - sample.waterDepthMeters * 0.02);
  const foam = shore * smoothstep(0.02, 0.6, sample.waterDepthMeters) * (1 - bands.cliff * 0.55);
  return normalizeWeights({
    grass: grass * (0.65 + dry * 0.15),
    soil,
    mud,
    sand,
    rock,
    scree,
    snow: snowSurface,
    wetEdge,
    foam,
  });
}

function deriveReliefSignals(sample, thresholds, bands) {
  const phase = seededUnit(DEFAULT_SEED, sample.x, sample.z, 0x51ed270b);
  const macro = clamp(
    0.08 + bands.ridge * 0.16 + bands.cliff * 0.18 + phase * 0.08,
    0.04,
    MAX_MACRO_CONTRAST,
  );
  const micro = clamp(
    0.045 + bands.ridge * 0.08 + bands.cliff * 0.09 + (1 - sample.confidence) * 0.04,
    0.02,
    MAX_MICRO_CONTRAST,
  );
  const talus = clamp01((sample.slopeDegrees - thresholds.screeSlopeDegrees + 10) / 36) * (1 - bands.snowline * 0.25);
  const rockExposure = clamp01(bands.cliff * 0.8 + bands.ridge * 0.35 + sample.slopeDegrees / 180);
  const snowlineBlend = clamp01(bands.snowline * (0.7 + seededUnit(DEFAULT_SEED, sample.x, sample.z, 0x1f123bb5) * 0.18));
  return Object.freeze({
    macroContrast: macro,
    microContrast: micro,
    talusFactor: clamp01(talus),
    rockExposure: clamp01(rockExposure),
    snowlineBlend,
    antiTilingPhase: Object.freeze({
      x: seededUnit(DEFAULT_SEED, sample.x, sample.z, 0x9e3779b9),
      z: seededUnit(DEFAULT_SEED, sample.x, sample.z, 0x243f6a88),
      rotationRadians: (seededUnit(DEFAULT_SEED, sample.x, sample.z, 0xb7e15162) - 0.5) * 0.6,
    }),
  });
}

function deriveMaterialResponse(sample, weights, relief, bands) {
  const slopeRoughness = clamp01(sample.slopeDegrees / 90) * 0.18;
  const snowRoughness = weights.snow * 0.12;
  const wetReduction = weights.wetEdge * 0.17 + weights.foam * 0.1;
  const roughness = clamp(0.58 + slopeRoughness + snowRoughness - wetReduction, MIN_ROUGHNESS, MAX_ROUGHNESS);
  const normalEnergy = clamp(
    0.18 + relief.microContrast * 1.35 + relief.macroContrast * 0.42 + relief.rockExposure * 0.18,
    MIN_NORMAL_ENERGY,
    MAX_NORMAL_ENERGY,
  );
  const albedoVariation = clamp(
    0.12 + relief.macroContrast * 0.7 + relief.rockExposure * 0.2,
    0.05,
    0.45,
  );
  return Object.freeze({
    roughness,
    normalEnergy,
    albedoVariation,
    aoStrength: clamp(0.22 + bands.cliff * 0.2 + bands.ridge * 0.08, 0.15, 0.72),
    clearcoat: clamp(weights.wetEdge * 0.25 + weights.foam * 0.08, 0, 0.32),
    distanceFadeMeters: clamp(280 + sample.elevationMeters * 0.15, 160, 900),
  });
}

function deriveWaterResponse(sample, bands) {
  const depth = clamp01(sample.waterDepthMeters / 24);
  const shore = bands.shoreline;
  const wet = bands.wetEdge;
  return Object.freeze({
    deepWeight: clamp01(depth * (1 - shore * 0.75)),
    shallowWeight: clamp01((1 - depth) * (0.45 + shore * 0.55)),
    wetEdgeWeight: clamp01(wet * (1 - depth * 0.35)),
    foamWeight: clamp01(shore * smoothstep(0.02, 0.7, sample.waterDepthMeters)),
    antiMoireStrength: clamp(0.68 + wet * 0.28 + shore * 0.12, 0, 1),
    rectangularCoverageRisk: sample.waterDepthMeters > 0 && sample.waterDistanceMeters > 90 && shore < 0.12,
    stripeRisk: sample.waterDepthMeters > 0 && sample.waterDistanceMeters < 45,
  });
}

function deriveVegetationEligibility(sample, bands, thresholds) {
  const blocked = [];
  if (sample.waterDepthMeters > 0.05 || sample.elevationMeters <= thresholds.waterLevelMeters + 0.25) blocked.push('water');
  if (sample.slopeDegrees >= thresholds.cliffSlopeDegrees) blocked.push('cliff');
  if (bands.snowline > 0.8) blocked.push('permanent-snow');
  if (sample.roadDistanceMeters < 6) blocked.push('road');
  if (sample.settlementDistanceMeters < 18) blocked.push('settlement');
  if (sample.confidence < thresholds.highConfidenceThreshold) blocked.push('low-confidence');
  const eligible = blocked.length === 0;
  const density = eligible
    ? clamp((0.3 + sample.moisture * 0.8) * (1 - bands.ridge * 0.65) * (1 - bands.shoreline * 0.55), 0, 1)
    : 0;
  const ecotone = clamp01(Math.max(bands.shoreline, bands.snowline, bands.ridge * 0.65));
  return Object.freeze({
    eligible,
    blockedReasons: Object.freeze(blocked),
    density,
    ecotone,
    forestCanopyWeight: clamp01(density * (sample.moisture >= thresholds.forestMoistureThreshold ? 1 : 0.35)),
    shrubWeight: clamp01(density * (1 - bands.ridge * 0.35)),
    grassDetailWeight: clamp01((1 - bands.snowline * 0.85) * (0.35 + sample.moisture * 0.55)),
    yawJitterRadians: (seededUnit(DEFAULT_SEED, sample.x, sample.z, 0x85ebca6b) - 0.5) * 0.55,
    scaleJitter: 0.86 + seededUnit(DEFAULT_SEED, sample.x, sample.z, 0xc2b2ae35) * 0.28,
    lodBias: clamp(bands.ridge * 0.85 + bands.cliff * 0.5 + bands.shoreline * 0.25, 0, 1),
    instancingGroup: eligible ? (bands.snowline > 0.25 ? 'alpine-ground-detail' : bands.ridge > 0.5 ? 'ridge-shrub' : 'forest-floor') : null,
  });
}

function parityEvidence(observations = {}) {
  const canonical = observations.canonical || observations.reference || {};
  const rendered = observations.rendered || {};
  const collider = observations.collider || {};
  const canonicalHeight = finiteNumber(canonical.heightMeters ?? canonical.elevationMeters, 0);
  const renderedHeight = finiteNumber(rendered.heightMeters ?? rendered.elevationMeters, canonicalHeight);
  const colliderHeight = finiteNumber(collider.heightMeters ?? collider.elevationMeters, canonicalHeight);
  const renderDelta = Math.abs(renderedHeight - canonicalHeight);
  const colliderDelta = Math.abs(colliderHeight - canonicalHeight);
  return Object.freeze({
    canonicalHeight,
    renderedHeight,
    colliderHeight,
    renderDeltaMeters: renderDelta,
    colliderDeltaMeters: colliderDelta,
    renderWithinTolerance: renderDelta <= 0.35,
    colliderWithinTolerance: colliderDelta <= 0.35,
    sameWorldSpace: observations.sameWorldSpace !== false,
  });
}

function stableSerialize(value) {
  if (Array.isArray(value)) return `[${value.map(stableSerialize).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export function createTerrainReliefMaterialProfile({ sample = {}, thresholds = {}, seed = DEFAULT_SEED, observations = {} } = {}) {
  const normalizedThresholds = normalizeThresholds(thresholds);
  const normalizedSample = normalizeSample(sample, normalizedThresholds);
  const bands = deriveBandWeights(normalizedSample, normalizedThresholds);
  const reliefBand = deriveReliefBand(normalizedSample, normalizedThresholds);
  const surfaceWeights = deriveSurfaceWeights(normalizedSample, normalizedThresholds, bands);
  const relief = deriveReliefSignals(normalizedSample, normalizedThresholds, bands);
  const materials = deriveMaterialResponse(normalizedSample, surfaceWeights, relief, bands);
  const water = deriveWaterResponse(normalizedSample, bands);
  const vegetation = deriveVegetationEligibility(normalizedSample, bands, normalizedThresholds);
  const parity = parityEvidence(observations);
  const profile = {
    version: 'v35',
    seed: finiteNumber(seed, DEFAULT_SEED) | 0,
    sample: normalizedSample,
    thresholds: normalizedThresholds,
    reliefBand,
    bandWeights: bands,
    surfaceWeights,
    relief,
    materials,
    water,
    vegetation,
    parity,
    acceptance: {
      visibleGridOrSeamTarget: 0,
      visibleRectangularWaterTarget: 0,
      visibleWaterMoireTarget: 0,
      floatingVegetationTarget: 0,
      snowAsFlatWhiteTarget: 0,
      blackSkyTarget: 0,
      placeholderAssetTarget: 0,
      materialMismatchTarget: 0,
    },
  };
  const digest = fnv1a(stableSerialize(profile));
  return deepFreeze({ ...profile, digest });
}

export function applyTerrainReliefMaterialProfile(material, profile = {}) {
  if (!material || typeof material !== 'object') return material;
  const materials = profile.materials || {};
  if (Number.isFinite(material.roughness)) material.roughness = clamp(materials.roughness, MIN_ROUGHNESS, MAX_ROUGHNESS);
  if (Number.isFinite(material.normalScale)) material.normalScale = clamp(materials.normalEnergy, MIN_NORMAL_ENERGY, MAX_NORMAL_ENERGY);
  if (Number.isFinite(material.aoMapIntensity)) material.aoMapIntensity = clamp(materials.aoStrength, 0.15, 0.72);
  if (Number.isFinite(material.clearcoat)) material.clearcoat = clamp(materials.clearcoat, 0, 0.32);
  material.userData = {
    ...(material.userData || {}),
    terrainReliefMaterialAdoption: {
      version: profile.version || 'v35',
      digest: profile.digest || null,
      antiTilingPhase: profile.relief?.antiTilingPhase || null,
      surfaceWeights: profile.surfaceWeights || null,
      reliefBand: profile.reliefBand || null,
    },
  };
  return material;
}

export function createTerrainReliefManifest(samples = [], options = {}) {
  const profiles = (Array.isArray(samples) ? samples : []).map((sample) => createTerrainReliefMaterialProfile({ ...options, sample }));
  const ordered = profiles.slice().sort((a, b) => {
    const az = a.sample.z - b.sample.z;
    if (Math.abs(az) > EPSILON) return az;
    return a.sample.x - b.sample.x;
  });
  const summary = {
    version: 'v35',
    sampleCount: ordered.length,
    reliefBands: Object.fromEntries(RELIEF_BANDS.map((band) => [band, ordered.filter((profile) => profile.reliefBand === band).length])),
    visibleWaterRiskCount: ordered.filter((profile) => profile.water.rectangularCoverageRisk || profile.water.stripeRisk).length,
    parityFailureCount: ordered.filter((profile) => !profile.parity.renderWithinTolerance || !profile.parity.colliderWithinTolerance).length,
    vegetationBlockedCount: ordered.filter((profile) => !profile.vegetation.eligible).length,
  };
  return deepFreeze({
    version: 'v35',
    profiles: ordered,
    summary,
    digest: fnv1a(stableSerialize({ profiles: ordered, summary })),
  });
}

export function evaluateTerrainReliefAcceptance(manifest, { maxParityDeltaMeters = 0.35 } = {}) {
  const profiles = Array.isArray(manifest?.profiles) ? manifest.profiles : [];
  const findings = [];
  for (const profile of profiles) {
    if (profile.water?.rectangularCoverageRisk) findings.push({ code: 'P0_RECTANGULAR_WATER_RISK', x: profile.sample.x, z: profile.sample.z });
    if (profile.water?.stripeRisk) findings.push({ code: 'P0_WATER_MOIRE_RISK', x: profile.sample.x, z: profile.sample.z });
    if (profile.reliefBand === 'cliff' && profile.relief?.rockExposure < 0.3) findings.push({ code: 'P1_FLAT_CLIFF_RISK', x: profile.sample.x, z: profile.sample.z });
    if (profile.reliefBand === 'snowline' && profile.relief?.snowlineBlend < 0.3) findings.push({ code: 'P2_FLAT_SNOW_RISK', x: profile.sample.x, z: profile.sample.z });
    if (profile.materials?.normalEnergy < MIN_NORMAL_ENERGY || profile.materials?.normalEnergy > MAX_NORMAL_ENERGY) findings.push({ code: 'P2_NORMAL_ENERGY_OUT_OF_BOUNDS', x: profile.sample.x, z: profile.sample.z });
    if (profile.parity?.renderDeltaMeters > maxParityDeltaMeters) findings.push({ code: 'P1_RENDER_CANONICAL_PARITY_RISK', x: profile.sample.x, z: profile.sample.z });
    if (profile.parity?.colliderDeltaMeters > maxParityDeltaMeters) findings.push({ code: 'P1_COLLIDER_CANONICAL_PARITY_RISK', x: profile.sample.x, z: profile.sample.z });
    if (profile.vegetation?.eligible && profile.sample.waterDepthMeters > 0.05) findings.push({ code: 'P3_WATER_VEGETATION_RISK', x: profile.sample.x, z: profile.sample.z });
  }
  return deepFreeze({
    version: 'v35',
    pass: findings.length === 0,
    findingCount: findings.length,
    findings,
    targets: {
      visibleGridOrSeam: 0,
      visibleRectangularWater: 0,
      visibleWaterMoire: 0,
      floatingVegetation: 0,
      materialMismatch: 0,
    },
  });
}

export const TERRAIN_RELIEF_MATERIAL_POLICY_V35 = Object.freeze({
  version: 'v35',
  surfaces: SURFACES,
  reliefBands: RELIEF_BANDS,
  constants: Object.freeze({
    EPSILON,
    MIN_ROUGHNESS,
    MAX_ROUGHNESS,
    MIN_NORMAL_ENERGY,
    MAX_NORMAL_ENERGY,
    MAX_MACRO_CONTRAST,
    MAX_MICRO_CONTRAST,
  }),
});

export default Object.freeze({
  createTerrainReliefMaterialProfile,
  applyTerrainReliefMaterialProfile,
  createTerrainReliefManifest,
  evaluateTerrainReliefAcceptance,
  TERRAIN_RELIEF_MATERIAL_POLICY_V35,
});
