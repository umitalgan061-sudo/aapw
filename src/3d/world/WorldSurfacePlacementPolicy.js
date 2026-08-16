export const WORLD_SURFACE_POLICY_PRESETS = Object.freeze({
  vegetation: Object.freeze({
    maxSlopeDegrees: 38,
    maxWaterDepth: 0.05,
    minRoadDistance: 0.75,
    forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff'],
  }),
  tree: Object.freeze({
    maxSlopeDegrees: 34,
    maxWaterDepth: 0.05,
    minRoadDistance: 1.5,
    forbiddenBiomes: ['ocean', 'lake', 'river', 'cliff', 'alpine-bare'],
  }),
  rock: Object.freeze({
    maxSlopeDegrees: 72,
    maxWaterDepth: 0.8,
  }),
  building: Object.freeze({
    maxSlopeDegrees: 12,
    maxWaterDepth: 0.02,
    minRoadDistance: 0,
  }),
  settlement: Object.freeze({
    maxSlopeDegrees: 12,
    maxWaterDepth: 0.02,
    minRoadDistance: 0,
  }),
  bridge: Object.freeze({
    maxSlopeDegrees: 24,
    maxWaterDepth: Infinity,
  }),
});

export function resolveWorldSurfacePolicy(metadata = {}, override = null) {
  const category = String(metadata.category || metadata.kind || '').toLowerCase();
  const preset = WORLD_SURFACE_POLICY_PRESETS[category] || null;
  return normalizePlacementPolicy({ ...(preset || {}), ...(override || {}) });
}

export function normalizeWorldSurfaceSample(sample) {
  if (Number.isFinite(Number(sample))) sample = { height: Number(sample) };
  if (!sample || typeof sample !== 'object') {
    return { ok: false, error: 'missing-sample', sample: null };
  }

  const height = Number(sample.height ?? sample.groundHeight ?? sample.y);
  if (!Number.isFinite(height)) {
    return { ok: false, error: 'non-finite-height', sample: { ...sample, height: null } };
  }

  const normalized = {
    height,
    slopeDegrees: optionalFinite(sample.slopeDegrees ?? sample.slope),
    waterDepth: optionalFinite(sample.waterDepth),
    roadDistance: optionalFinite(sample.roadDistance),
    settlementDistance: optionalFinite(sample.settlementDistance),
    moisture: optionalFinite(sample.moisture),
    biome: sample.biome == null ? null : String(sample.biome).toLowerCase(),
    waterType: sample.waterType == null ? null : String(sample.waterType).toLowerCase(),
  };

  for (const key of ['slopeDegrees', 'waterDepth', 'roadDistance', 'settlementDistance']) {
    if (normalized[key] !== null && normalized[key] < 0) {
      return { ok: false, error: `negative-${key}`, sample: normalized };
    }
  }
  return { ok: true, sample: normalized };
}

export function evaluateWorldSurfacePlacement(surface, policy = {}) {
  const normalizedSurface = normalizeWorldSurfaceSample(surface);
  if (!normalizedSurface.ok) return { ok: false, errors: [normalizedSurface.error], surface: normalizedSurface.sample };
  const normalizedPolicy = normalizePlacementPolicy(policy);
  const sample = normalizedSurface.sample;
  const errors = [];

  compareMax(errors, 'slope-too-steep', sample.slopeDegrees, normalizedPolicy.maxSlopeDegrees);
  compareMin(errors, 'slope-too-flat', sample.slopeDegrees, normalizedPolicy.minSlopeDegrees);
  compareMax(errors, 'water-too-deep', sample.waterDepth, normalizedPolicy.maxWaterDepth);
  compareMin(errors, 'water-too-shallow', sample.waterDepth, normalizedPolicy.minWaterDepth);
  compareMin(errors, 'too-close-to-road', sample.roadDistance, normalizedPolicy.minRoadDistance);
  compareMax(errors, 'too-far-from-road', sample.roadDistance, normalizedPolicy.maxRoadDistance);
  compareMin(errors, 'too-close-to-settlement', sample.settlementDistance, normalizedPolicy.minSettlementDistance);
  compareMax(errors, 'too-far-from-settlement', sample.settlementDistance, normalizedPolicy.maxSettlementDistance);

  if (sample.biome && normalizedPolicy.allowedBiomes.length && !normalizedPolicy.allowedBiomes.includes(sample.biome)) {
    errors.push('biome-not-allowed');
  }
  if (sample.biome && normalizedPolicy.forbiddenBiomes.includes(sample.biome)) {
    errors.push('biome-forbidden');
  }
  if (sample.waterType && normalizedPolicy.allowedWaterTypes.length && !normalizedPolicy.allowedWaterTypes.includes(sample.waterType)) {
    errors.push('water-type-not-allowed');
  }
  if (sample.waterType && normalizedPolicy.forbiddenWaterTypes.includes(sample.waterType)) {
    errors.push('water-type-forbidden');
  }

  return { ok: errors.length === 0, errors, surface: sample, policy: normalizedPolicy };
}

export function normalizePlacementPolicy(policy = {}) {
  return {
    minSlopeDegrees: optionalFinite(policy.minSlopeDegrees),
    maxSlopeDegrees: optionalFinite(policy.maxSlopeDegrees, true),
    minWaterDepth: optionalFinite(policy.minWaterDepth),
    maxWaterDepth: optionalFinite(policy.maxWaterDepth, true),
    minRoadDistance: optionalFinite(policy.minRoadDistance),
    maxRoadDistance: optionalFinite(policy.maxRoadDistance, true),
    minSettlementDistance: optionalFinite(policy.minSettlementDistance),
    maxSettlementDistance: optionalFinite(policy.maxSettlementDistance, true),
    allowedBiomes: normalizedStringList(policy.allowedBiomes),
    forbiddenBiomes: normalizedStringList(policy.forbiddenBiomes),
    allowedWaterTypes: normalizedStringList(policy.allowedWaterTypes),
    forbiddenWaterTypes: normalizedStringList(policy.forbiddenWaterTypes),
  };
}

function normalizedStringList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => String(item).toLowerCase()).filter(Boolean))].sort();
}

function compareMin(errors, message, value, limit) {
  if (value !== null && limit !== null && value < limit) errors.push(message);
}

function compareMax(errors, message, value, limit) {
  if (value !== null && limit !== null && value > limit) errors.push(message);
}

function optionalFinite(value, allowInfinity = false) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (allowInfinity && number === Infinity) return Infinity;
  return Number.isFinite(number) ? number : null;
}
