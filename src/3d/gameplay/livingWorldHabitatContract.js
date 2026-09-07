/**
 * Runtime-facing habitat contract for the existing living-world spawn adapters.
 * This is a validator/normalizer only; it does not own spawning, navigation, factions or ecology.
 * @module gameplay/livingWorldHabitatContract
 */

const NUMERIC = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;

export const LIVING_WORLD_HABITAT_RULES = Object.freeze({
  npc: Object.freeze({ allowWater: false, maxSlopeDegrees: 28, minRoadDistance: 0, minSettlementDistance: 0 }),
  horse: Object.freeze({ allowWater: false, maxSlopeDegrees: 24, minRoadDistance: 0, minSettlementDistance: 0 }),
  wildlife: Object.freeze({ allowWater: false, maxSlopeDegrees: 34, minRoadDistance: 10, minSettlementDistance: 12 }),
  dragon: Object.freeze({ allowWater: true, maxSlopeDegrees: 48, minRoadDistance: 0, minSettlementDistance: 18 }),
});

function ruleFor(kind) {
  return LIVING_WORLD_HABITAT_RULES[kind] ?? LIVING_WORLD_HABITAT_RULES.wildlife;
}

export function normalizeLivingWorldHabitatSample(sample = {}) {
  return Object.freeze({
    kind: typeof sample.kind === 'string' ? sample.kind : 'wildlife',
    biome: typeof sample.biome === 'string' ? sample.biome : 'temperate',
    water: Boolean(sample.water),
    slopeDegrees: Math.max(0, NUMERIC(sample.slopeDegrees)),
    roadDistance: Math.max(0, NUMERIC(sample.roadDistance)),
    settlementDistance: Math.max(0, NUMERIC(sample.settlementDistance)),
    groundY: NUMERIC(sample.groundY),
    navReachable: sample.navReachable !== false,
  });
}

export function validateLivingWorldHabitatSample(sample = {}) {
  const normalized = normalizeLivingWorldHabitatSample(sample);
  const rule = ruleFor(normalized.kind);
  const failures = [];
  if (!normalized.navReachable) failures.push('nav-unreachable');
  if (!rule.allowWater && normalized.water) failures.push('water-forbidden');
  if (normalized.slopeDegrees > rule.maxSlopeDegrees) failures.push('slope-too-steep');
  if (normalized.roadDistance < rule.minRoadDistance) failures.push('road-buffer');
  if (normalized.settlementDistance < rule.minSettlementDistance) failures.push('settlement-buffer');
  return Object.freeze({
    valid: failures.length === 0,
    kind: normalized.kind,
    biome: normalized.biome,
    failures: Object.freeze(failures),
    normalized,
  });
}

export function habitatDecision(sample = {}) {
  const result = validateLivingWorldHabitatSample(sample);
  return Object.freeze({
    accepted: result.valid,
    reason: result.valid ? 'habitat-aligned' : result.failures[0],
    manifest: Object.freeze({
      kind: result.kind,
      biome: result.biome,
      groundY: result.normalized.groundY,
      water: result.normalized.water,
      slopeDegrees: result.normalized.slopeDegrees,
      roadDistance: result.normalized.roadDistance,
      settlementDistance: result.normalized.settlementDistance,
    }),
  });
}
