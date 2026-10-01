/**
 * Runtime-facing habitat contract for the existing living-world spawn adapters.
 * This is a validator/normalizer only; it does not own spawning, navigation, factions or ecology.
 * @module gameplay/livingWorldHabitatContract
 */

const NUMERIC = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const DIGEST = (value) => Array.from(String(value)).reduce((hash, char) => ((hash * 33) ^ char.charCodeAt(0)) >>> 0, 5381).toString(16).padStart(8, '0');

export const LIVING_WORLD_HABITAT_RULES = Object.freeze({
  npc: Object.freeze({ allowWater: false, maxSlopeDegrees: 28, minRoadDistance: 0, minSettlementDistance: 0, biomes: null }),
  horse: Object.freeze({ allowWater: false, maxSlopeDegrees: 24, minRoadDistance: 0, minSettlementDistance: 0, biomes: null }),
  wildlife: Object.freeze({ allowWater: false, maxSlopeDegrees: 34, minRoadDistance: 10, minSettlementDistance: 12, biomes: null }),
  dragon: Object.freeze({ allowWater: true, maxSlopeDegrees: 48, minRoadDistance: 0, minSettlementDistance: 18, biomes: new Set(['mountain', 'snow', 'north', 'arid', 'desert', 'volcanic', 'valyria']) }),
});

const BIOME_ALIASES = Object.freeze({
  frozen: 'snow',
  cold: 'north',
  highland: 'mountain',
  lava: 'volcanic',
});

function canonicalBiome(value) {
  const raw = typeof value === 'string' && value.trim() ? value.trim().toLowerCase() : 'temperate';
  return BIOME_ALIASES[raw] ?? raw;
}

function ruleFor(kind) {
  return LIVING_WORLD_HABITAT_RULES[kind] ?? LIVING_WORLD_HABITAT_RULES.wildlife;
}

export function normalizeLivingWorldHabitatSample(sample = {}) {
  return Object.freeze({
    kind: typeof sample.kind === 'string' ? sample.kind : 'wildlife',
    biome: canonicalBiome(sample.biome),
    water: Boolean(sample.water),
    slopeDegrees: Math.max(0, NUMERIC(sample.slopeDegrees)),
    roadDistance: Math.max(0, NUMERIC(sample.roadDistance)),
    settlementDistance: Math.max(0, NUMERIC(sample.settlementDistance)),
    groundY: NUMERIC(sample.groundY),
    navReachable: sample.navReachable !== false,
    surface: typeof sample.surface === 'string' ? sample.surface : 'wilderness',
    habitatKey: typeof sample.habitatKey === 'string' ? sample.habitatKey : '',
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
  if (rule.biomes && !rule.biomes.has(normalized.biome)) failures.push('biome-mismatch');
  if (normalized.surface === 'settlement-edge' && normalized.kind === 'wildlife') failures.push('settlement-edge-wildlife');
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
  const normalized = result.normalized;
  const manifest = {
    kind: result.kind,
    biome: result.biome,
    surface: normalized.surface,
    habitatKey: normalized.habitatKey,
    groundY: normalized.groundY,
    water: normalized.water,
    slopeDegrees: normalized.slopeDegrees,
    roadDistance: normalized.roadDistance,
    settlementDistance: normalized.settlementDistance,
  };
  manifest.digest = DIGEST(JSON.stringify(manifest));
  return Object.freeze({
    accepted: result.valid,
    reason: result.valid ? 'habitat-aligned' : result.failures[0],
    manifest: Object.freeze(manifest),
  });
}

export function habitatEvidence(sample = {}) {
  const decision = habitatDecision(sample);
  return Object.freeze({
    accepted: decision.accepted,
    reason: decision.reason,
    digest: decision.manifest.digest,
    context: Object.freeze({
      kind: decision.manifest.kind,
      biome: decision.manifest.biome,
      surface: decision.manifest.surface,
      habitatKey: decision.manifest.habitatKey,
      groundAligned: Number.isFinite(decision.manifest.groundY),
      waterSafe: decision.reason !== 'water-forbidden',
      navSafe: decision.reason !== 'nav-unreachable',
    }),
  });
}
