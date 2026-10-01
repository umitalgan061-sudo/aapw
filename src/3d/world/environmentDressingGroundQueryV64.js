const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp01 = (value) => Math.min(1, Math.max(0, finite(value)));
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const text = (value, fallback) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const round = (value) => Math.round(finite(value) * 1e6) / 1e6;

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

function hashString(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export const V64_GROUND_QUERY_CONTRACT = Object.freeze({
  id: 'buzul-muhafizi-ground-query-v64-20260914',
  owner: 'Buzul Muhafızı',
  canonicalSource: 'caller-owned-canonical-world',
  modes: Object.freeze(['ground', 'water', 'biome', 'placement', 'navigation']),
});

function normalizeSample(sample = {}) {
  return freeze({
    x: finite(sample.x),
    y: finite(sample.y),
    z: finite(sample.z),
    canonicalHeight: finite(sample.canonicalHeight, sample.y),
    colliderHeight: finite(sample.colliderHeight, sample.y),
    slope: clamp(sample.slope, 0, 89.9),
    moisture: clamp01(sample.moisture),
    elevation01: clamp01(sample.elevation01),
    snowWeight: clamp01(sample.snowWeight),
    biome: text(sample.biome, 'unknown').toLowerCase(),
    surface: text(sample.surface, 'unknown').toLowerCase(),
    waterClass: text(sample.waterClass, 'land').toLowerCase(),
    waterDistance: clamp(sample.waterDistance, 0, 50000),
    waterDepth: clamp(sample.waterDepth, 0, 2000),
    roadDistance: clamp(sample.roadDistance, 0, 50000),
    settlementDistance: clamp(sample.settlementDistance, 0, 50000),
    groundConfidence: clamp01(sample.groundConfidence ?? 1),
    normal: freeze({
      x: finite(sample.normal?.x),
      y: finite(sample.normal?.y, 1),
      z: finite(sample.normal?.z),
    }),
    canonicalSource: text(sample.canonicalSource, V64_GROUND_QUERY_CONTRACT.canonicalSource),
  });
}

export function createGroundQueryV64(sample) {
  const normalized = normalizeSample(sample);
  const parityDelta = Math.abs(normalized.y - normalized.colliderHeight);
  const water = normalized.waterClass !== 'land' && normalized.waterClass !== 'unknown';
  const safeForPlayer = normalized.groundConfidence >= 0.72 && normalized.slope <= 68 && !water && normalized.waterDepth <= 0.05;
  const safeForTree = normalized.groundConfidence >= 0.8 && normalized.slope <= 55 && !water && normalized.waterDepth <= 0.05 && normalized.permanentSnow !== true;
  const navigable = safeForPlayer && normalized.slope <= 42;
  return freeze({
    contract: V64_GROUND_QUERY_CONTRACT.id,
    mode: 'ground',
    position: Object.freeze({ x: normalized.x, y: normalized.y, z: normalized.z }),
    height: normalized.canonicalHeight,
    colliderHeight: normalized.colliderHeight,
    parityMeters: round(parityDelta),
    parityPass: parityDelta <= 0.35,
    normal: normalized.normal,
    slopeDegrees: normalized.slope,
    groundConfidence: normalized.groundConfidence,
    safeForPlayer,
    safeForTree,
    navigable,
    source: normalized.canonicalSource,
    fingerprint: hashString(JSON.stringify(normalized)),
  });
}

export function createWaterQueryV64(sample) {
  const normalized = normalizeSample(sample);
  const recognized = ['sea', 'lake', 'river', 'land', 'unknown'].includes(normalized.waterClass);
  const isWater = recognized && normalized.waterClass !== 'land' && normalized.waterClass !== 'unknown';
  return freeze({
    contract: V64_GROUND_QUERY_CONTRACT.id,
    mode: 'water',
    recognized,
    waterClass: recognized ? normalized.waterClass : 'unknown',
    isWater,
    depth: round(normalized.waterDepth),
    distance: round(normalized.waterDistance),
    shorelineBand: round(isWater ? Math.max(0, 1 - normalized.waterDistance / 36) : 0),
    wetEdgeBand: round(isWater ? Math.max(0, 1 - normalized.waterDistance / 58) : 0),
    placementBlocked: isWater && normalized.waterDistance < 7,
  });
}

export function createBiomeQueryV64(sample) {
  const normalized = normalizeSample(sample);
  const cold = normalized.snowWeight > 0.6 || normalized.elevation01 > 0.86;
  const wet = normalized.moisture > 0.65;
  return freeze({
    contract: V64_GROUND_QUERY_CONTRACT.id,
    mode: 'biome',
    biome: normalized.biome,
    surface: normalized.surface,
    moisture: normalized.moisture,
    elevation01: normalized.elevation01,
    snowWeight: normalized.snowWeight,
    cold,
    wet,
    slope: normalized.slope,
    fingerprint: hashString(`${normalized.biome}|${normalized.surface}|${normalized.moisture}|${normalized.snowWeight}`),
  });
}

export function createPlacementQueryV64(sample, options = {}) {
  const normalized = normalizeSample(sample);
  const type = text(options.type, 'vegetation').toLowerCase();
  const minConfidence = clamp(options.minGroundConfidence ?? 0.72, 0, 1);
  const reasons = [];
  if (normalized.groundConfidence < minConfidence) reasons.push('low-ground-confidence');
  if (normalized.slope > (type === 'rock' ? 76 : 58)) reasons.push('slope');
  if (normalized.waterClass !== 'land' && normalized.waterClass !== 'unknown' && normalized.waterDistance < 7) reasons.push('water');
  if (normalized.waterDepth > 0.05) reasons.push('water-depth');
  if (normalized.roadDistance < 3) reasons.push('road');
  if (normalized.settlementDistance < 8) reasons.push('settlement');
  if (normalized.surface === 'road' || normalized.surface === 'settlement') reasons.push('reserved-surface');
  const eligible = reasons.length === 0;
  return freeze({
    contract: V64_GROUND_QUERY_CONTRACT.id,
    mode: 'placement',
    type,
    eligible,
    reasons: Object.freeze(reasons),
    transform: Object.freeze({
      x: round(normalized.x),
      y: round(normalized.colliderHeight),
      z: round(normalized.z),
    }),
    sharedGroundAuthority: true,
  });
}

export function createNavigationQueryV64(sample) {
  const normalized = normalizeSample(sample);
  const walkable = normalized.slope <= 42 && normalized.groundConfidence >= 0.72 && normalized.waterDepth <= 0.05 && normalized.surface !== 'water';
  return freeze({
    contract: V64_GROUND_QUERY_CONTRACT.id,
    mode: 'navigation',
    walkable,
    slopeDegrees: normalized.slope,
    stepHeightMeters: round(clamp(0.24 + (42 - normalized.slope) * 0.009, 0.24, 0.55)),
    source: normalized.canonicalSource,
  });
}

export function createV64QuerySnapshot(sample, options = {}) {
  const ground = createGroundQueryV64(sample);
  const water = createWaterQueryV64(sample);
  const biome = createBiomeQueryV64(sample);
  const placement = createPlacementQueryV64(sample, options);
  const navigation = createNavigationQueryV64(sample);
  return freeze({
    contract: V64_GROUND_QUERY_CONTRACT.id,
    ground,
    water,
    biome,
    placement,
    navigation,
    fingerprint: hashString(JSON.stringify({ ground, water, biome, placement, navigation })),
  });
}

export function compareV64QuerySnapshots(first, second) {
  return freeze({
    same: first?.fingerprint === second?.fingerprint,
    firstFingerprint: first?.fingerprint ?? 'none',
    secondFingerprint: second?.fingerprint ?? 'none',
  });
}
