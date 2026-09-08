/**
 * Environmental fit contract for settlement-fringe props.
 *
 * This module is deliberately read-only: it consumes an already-computed visual terrain sample and
 * determines whether a prop family is visually/ecologically plausible at that location. Canonical
 * terrain, hydrology, settlement placement, asset loading and material ownership remain elsewhere.
 *
 * The contract is intended to catch visually jarring combinations such as farm dirt on snow/rock,
 * a bonfire sitting in saturated wetlands, or maritime cargo being placed far from any access edge.
 * It is deterministic, world-space based and safe for browser/Node CI contracts.
 */

export const GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY = Object.freeze({
  version: 1,
  id: 'settlement-fringe-geographic-prop-environment-2026-09-08-v1',
  transitionFloor: 0.12,
  strongBiomeThreshold: 0.62,
  moisture: Object.freeze({
    saturated: 0.80,
    damp: 0.55,
    dry: 0.25,
  }),
  slope: Object.freeze({
    gentle: 8,
    usable: 18,
    steep: 30,
  }),
  family: Object.freeze({
    barrel: Object.freeze({ maxWaterDepth: 0.06, maxSnowWeight: 0.95, maxRockWeight: 0.95, preferredMoistureMin: 0.18 }),
    crate: Object.freeze({ maxWaterDepth: 0.06, maxSnowWeight: 0.95, maxRockWeight: 0.90, preferredMoistureMin: 0.12 }),
    bench: Object.freeze({ maxWaterDepth: 0.04, maxSnowWeight: 0.92, maxRockWeight: 0.92, preferredMoistureMin: 0.12 }),
    bonfire: Object.freeze({ maxWaterDepth: 0.01, maxSnowWeight: 0.92, maxRockWeight: 0.88, preferredMoistureMax: 0.72 }),
    farmDirt: Object.freeze({ maxWaterDepth: 0.03, maxSnowWeight: 0.35, maxRockWeight: 0.52, preferredMoistureMin: 0.28, preferredMoistureMax: 0.78 }),
  }),
  roleBiome: Object.freeze({
    cold: Object.freeze({ allowed: Object.freeze(['snow', 'cold-grassland', 'mountain', 'rocky-hills']) }),
    fertile: Object.freeze({ allowed: Object.freeze(['marsh', 'lush-grassland', 'temperate-coast']) }),
    maritime: Object.freeze({ allowed: Object.freeze(['temperate-coast', 'lush-grassland']) }),
    mountain: Object.freeze({ allowed: Object.freeze(['mountain', 'rocky-hills', 'snow']) }),
    arid: Object.freeze({ allowed: Object.freeze(['desert', 'steppe', 'arid', 'rocky-hills']) }),
    jungle: Object.freeze({ allowed: Object.freeze(['jungle', 'lush-grassland', 'marsh']) }),
    temperate: Object.freeze({ allowed: Object.freeze(['lush-grassland', 'temperate-coast', 'steppe', 'rocky-hills']) }),
  }),
});

function numberOr(value, fallback = 0) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, numberOr(value)));
}

export function normalizeEnvironmentSample(sample = {}) {
  return Object.freeze({
    worldX: numberOr(sample.worldX),
    worldZ: numberOr(sample.worldZ),
    heightMeters: numberOr(sample.heightMeters),
    heightAboveSeaMeters: numberOr(sample.heightAboveSeaMeters),
    slopeDegrees: Math.max(0, Math.min(90, numberOr(sample.slopeDegrees))),
    waterDepth: Math.max(0, numberOr(sample.waterDepth)),
    biome: String(sample.biome ?? ''),
    biomeInfluence: clamp01(sample.biomeInfluence ?? sample.influence),
    rockWeight: clamp01(sample.rockWeight),
    snowWeight: clamp01(sample.snowWeight),
    waterWeight: clamp01(sample.waterWeight),
    moisture: clamp01(sample.moisture ?? sample.ecologicalMoisture),
    snowEdge: clamp01(sample.snowEdge),
    snowShelf: clamp01(sample.snowShelf),
    surfaceContrast: clamp01(sample.surfaceContrast),
    steep: clamp01(sample.steep),
    coastal: clamp01(sample.coastal),
  });
}

export function classifySlope(slopeDegrees) {
  const slope = numberOr(slopeDegrees);
  if (slope <= GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.slope.gentle) return 'gentle';
  if (slope <= GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.slope.usable) return 'usable';
  if (slope <= GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.slope.steep) return 'steep';
  return 'cliff';
}

export function classifyMoisture(moisture) {
  const value = clamp01(moisture);
  if (value >= GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.moisture.saturated) return 'saturated';
  if (value >= GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.moisture.damp) return 'damp';
  if (value <= GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.moisture.dry) return 'dry';
  return 'balanced';
}

export function isTransitionBiome(sample = {}) {
  return normalizeEnvironmentSample(sample).biomeInfluence < GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.transitionFloor;
}

export function isStrongBiome(sample = {}) {
  return normalizeEnvironmentSample(sample).biomeInfluence >= GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.strongBiomeThreshold;
}

export function roleBiomeCompatibility(roleId, biome) {
  const role = String(roleId ?? 'temperate');
  const allowed = GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.roleBiome[role]?.allowed;
  if (!allowed?.length) return 0.4;
  return allowed.includes(String(biome ?? '')) ? 1 : 0;
}

function familyProfile(family) {
  return GEOGRAPHIC_SETTLEMENT_PROP_ENVIRONMENT_POLICY.family[String(family ?? '')] || null;
}

export function familyEnvironmentCompatibility(family, sample = {}) {
  const normalized = normalizeEnvironmentSample(sample);
  const profile = familyProfile(family);
  if (!profile) return 0;

  let score = 1;
  if (normalized.waterDepth > profile.maxWaterDepth) return 0;
  score -= Math.max(0, normalized.rockWeight - profile.maxRockWeight) * 0.85;
  score -= Math.max(0, normalized.snowWeight - profile.maxSnowWeight) * 0.85;

  if (profile.preferredMoistureMin != null && normalized.moisture < profile.preferredMoistureMin) {
    score -= Math.min(0.65, (profile.preferredMoistureMin - normalized.moisture) * 1.25);
  }
  if (profile.preferredMoistureMax != null && normalized.moisture > profile.preferredMoistureMax) {
    score -= Math.min(0.65, (normalized.moisture - profile.preferredMoistureMax) * 1.25);
  }
  return clamp01(score);
}

export function familySnowSuitability(family, sample = {}) {
  const normalized = normalizeEnvironmentSample(sample);
  const profile = familyProfile(family);
  if (!profile) return 0;
  if (normalized.snowWeight <= 0.05) return family === 'farmDirt' ? 1 : 0.75;
  if (family === 'farmDirt') return clamp01(1 - normalized.snowWeight * 1.8);
  if (family === 'bonfire') return clamp01(0.92 - normalized.snowWeight * 0.45 + normalized.snowShelf * 0.18);
  return clamp01(0.68 + normalized.snowShelf * 0.20 - normalized.snowWeight * 0.18);
}

export function familyWetnessSuitability(family, sample = {}) {
  const normalized = normalizeEnvironmentSample(sample);
  if (normalized.waterDepth <= 0.01) return 1;
  const profile = familyProfile(family);
  if (!profile) return 0;
  return normalized.waterDepth <= profile.maxWaterDepth
    ? clamp01(1 - normalized.waterDepth / Math.max(profile.maxWaterDepth, 0.001) * 0.45)
    : 0;
}

export function familyTerrainSuitability(family, sample = {}) {
  const normalized = normalizeEnvironmentSample(sample);
  const slopeClass = classifySlope(normalized.slopeDegrees);
  if (slopeClass === 'cliff') return 0;
  if (family === 'farmDirt') {
    if (slopeClass === 'steep') return 0.18;
    if (slopeClass === 'usable') return 0.74;
    return 1;
  }
  if (family === 'bench') {
    if (slopeClass === 'steep') return 0.24;
    if (slopeClass === 'usable') return 0.80;
    return 1;
  }
  if (family === 'bonfire') {
    if (slopeClass === 'steep') return 0.38;
    if (slopeClass === 'usable') return 0.82;
    return 1;
  }
  return slopeClass === 'steep' ? 0.45 : slopeClass === 'usable' ? 0.86 : 1;
}

export function environmentFitScore({ family = '', roleId = 'temperate', sample = {}, roadDistance = Infinity } = {}) {
  const normalized = normalizeEnvironmentSample(sample);
  const biomeCompatibility = roleBiomeCompatibility(roleId, normalized.biome);
  const familyCompatibility = familyEnvironmentCompatibility(family, normalized);
  const snowSuitability = familySnowSuitability(family, normalized);
  const wetnessSuitability = familyWetnessSuitability(family, normalized);
  const terrainSuitability = familyTerrainSuitability(family, normalized);
  const transitionPenalty = isTransitionBiome(normalized) ? 0.88 : 1;
  const strongBiomeBonus = isStrongBiome(normalized) ? 1.05 : 1;

  const road = numberOr(roadDistance, Infinity);
  const access = !Number.isFinite(road)
    ? 0.70
    : road <= 12
      ? 1.0
      : road <= 30
        ? 0.92
        : 0.78;

  const weighted = (
    familyCompatibility * 0.30 +
    biomeCompatibility * 0.20 +
    snowSuitability * 0.16 +
    wetnessSuitability * 0.14 +
    terrainSuitability * 0.14 +
    access * 0.06
  );
  const score = clamp01(weighted * transitionPenalty * strongBiomeBonus);
  const reasons = [];
  if (biomeCompatibility >= 1) reasons.push('role-biome-match');
  else if (biomeCompatibility <= 0) reasons.push('role-biome-conflict');
  if (familyCompatibility >= 0.9) reasons.push('family-surface-match');
  else if (familyCompatibility < 0.5) reasons.push('family-surface-risk');
  if (snowSuitability >= 0.8) reasons.push('snow-compatible');
  else if (snowSuitability < 0.4) reasons.push('snow-risk');
  if (wetnessSuitability >= 0.8) reasons.push('wetness-compatible');
  else if (wetnessSuitability < 0.4) reasons.push('wetness-risk');
  if (terrainSuitability >= 0.8) reasons.push('terrain-usable');
  else if (terrainSuitability < 0.4) reasons.push('terrain-risk');
  if (access >= 0.95) reasons.push('road-access');
  else if (access < 0.8) reasons.push('remote-access');
  if (isTransitionBiome(normalized)) reasons.push('biome-transition');
  if (isStrongBiome(normalized)) reasons.push('strong-biome');

  return Object.freeze({
    family: String(family),
    roleId: String(roleId),
    score,
    accepted: score >= 0.48,
    components: Object.freeze({ biomeCompatibility, familyCompatibility, snowSuitability, wetnessSuitability, terrainSuitability, access, transitionPenalty, strongBiomeBonus }),
    sample: normalized,
    reasons: Object.freeze(reasons),
  });
}

export function chooseEnvironmentFamily({ roleId = 'temperate', candidates = [], sample = {}, roadDistance = Infinity } = {}) {
  const scored = (candidates || []).map((family) => environmentFitScore({ family, roleId, sample, roadDistance }));
  scored.sort((a, b) => b.score - a.score || a.family.localeCompare(b.family));
  return Object.freeze({
    winner: scored[0]?.family || null,
    score: scored[0]?.score ?? 0,
    accepted: scored[0]?.accepted ?? false,
    ranked: Object.freeze(scored),
  });
}

export function environmentFingerprint({ family = '', roleId = '', sample = {}, roadDistance = Infinity } = {}) {
  const fit = environmentFitScore({ family, roleId, sample, roadDistance });
  const parts = [
    family,
    roleId,
    fit.sample.biome,
    fit.score.toFixed(5),
    fit.components.familyCompatibility.toFixed(5),
    fit.components.snowSuitability.toFixed(5),
    fit.components.wetnessSuitability.toFixed(5),
    fit.components.terrainSuitability.toFixed(5),
    fit.components.access.toFixed(5),
  ];
  return parts.join('|');
}

export function validateEnvironmentFitBatch(records = []) {
  const errors = [];
  const warnings = [];
  const fingerprints = [];
  for (const [index, record] of (records || []).entries()) {
    const fit = environmentFitScore(record);
    fingerprints.push(environmentFingerprint(record));
    if (!fit.accepted) errors.push(`record-${index}:environment-fit=${fit.score.toFixed(3)}`);
    if (isTransitionBiome(fit.sample)) warnings.push(`record-${index}:transition-biome`);
    if (fit.components.roleBiomeConflict === true) warnings.push(`record-${index}:role-biome-conflict`);
  }
  return Object.freeze({
    ok: errors.length === 0,
    errors: Object.freeze(errors),
    warnings: Object.freeze(warnings),
    fingerprints: Object.freeze(fingerprints),
  });
}

export const __ENVIRONMENT_TEST_HOOKS = Object.freeze({
  numberOr,
  clamp01,
  familyProfile,
});
