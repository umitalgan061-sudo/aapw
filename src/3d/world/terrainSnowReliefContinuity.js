/**
 * Cross-chunk continuity helper for snow relief material signals.
 *
 * This is a render-only companion to terrainSnowReliefDirector.js. It reconciles samples taken on
 * either side of a chunk seam without introducing a visible grid, tile boundary or step. It does
 * not sample or mutate canonical height, hydrology, coastline, roads, settlements or colliders.
 */
const clamp01 = (value) => Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
const lerp = (a, b, t) => a + (b - a) * t;
const smoothstep = (a, b, value) => {
  const t = clamp01((value - a) / Math.max(1e-9, b - a));
  return t * t * (3 - 2 * t);
};

export const TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY = Object.freeze({
  id: 'terrain-snow-relief-continuity-2026-09-08-v1',
  renderOnly: true,
  canonicalAuthorityUnchanged: true,
  seamWindowMeters: 24,
  continuityOrder: 2,
  maxBlendDelta: 0.16,
  visibleSeamTarget: 0,
});

function finiteSignal(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

export function seamBlendWeight(distanceToSeamMeters, seamWindowMeters = TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY.seamWindowMeters) {
  const distance = Math.max(0, finiteSignal(distanceToSeamMeters, seamWindowMeters));
  return 1 - smoothstep(0, Math.max(0.001, seamWindowMeters), distance);
}

export function blendSnowReliefSamples(left = {}, right = {}, distanceToSeamMeters = 0) {
  const seamWeight = seamBlendWeight(distanceToSeamMeters);
  const keys = ['snow', 'packed', 'powder', 'firn', 'rock', 'scree', 'wetness', 'roughness', 'normal'];
  const result = {};
  for (const key of keys) {
    const a = clamp01(left[key]);
    const b = clamp01(right[key]);
    result[key] = lerp(a, b, seamWeight);
  }
  result.seamWeight = seamWeight;
  result.maxDelta = Math.max(...keys.map((key) => Math.abs(clamp01(left[key]) - clamp01(right[key]))));
  result.continuous = result.maxDelta <= TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY.maxBlendDelta || seamWeight === 0;
  return Object.freeze(result);
}

export function reconcileChunkBoundarySamples(samples = [], seamWindowMeters = TERRAIN_SNOW_RELIEF_CONTINUITY_POLICY.seamWindowMeters) {
  if (!Array.isArray(samples) || samples.length === 0) return Object.freeze({ accepted: false, samples: [], reasons: ['empty-sample-list'] });
  const normalized = samples.map((sample) => Object.freeze({
    distanceToSeamMeters: Math.max(0, finiteSignal(sample?.distanceToSeamMeters, seamWindowMeters)),
    snow: clamp01(sample?.snow),
    packed: clamp01(sample?.packed),
    powder: clamp01(sample?.powder),
    firn: clamp01(sample?.firn),
    rock: clamp01(sample?.rock),
    scree: clamp01(sample?.scree),
    wetness: clamp01(sample?.wetness),
    roughness: clamp01(sample?.roughness),
    normal: clamp01(sample?.normal),
  }));
  const smoothed = normalized.map((sample, index) => {
    const prev = normalized[Math.max(0, index - 1)];
    const next = normalized[Math.min(normalized.length - 1, index + 1)];
    const neighbor = blendSnowReliefSamples(prev, next, sample.distanceToSeamMeters);
    return Object.freeze({ ...sample, ...neighbor, sourceIndex: index });
  });
  const seamDeltas = smoothed.slice(1).map((sample, index) => Math.max(
    Math.abs(sample.snow - smoothed[index].snow),
    Math.abs(sample.packed - smoothed[index].packed),
    Math.abs(sample.powder - smoothed[index].powder),
    Math.abs(sample.firn - smoothed[index].firn),
    Math.abs(sample.rock - smoothed[index].rock),
    Math.abs(sample.scree - smoothed[index].scree),
  ));
  return Object.freeze({
    accepted: smoothed.every((sample) => sample.continuous !== false),
    seamDeltas,
    maxSeamDelta: seamDeltas.length ? Math.max(...seamDeltas) : 0,
    samples: smoothed,
    reasons: smoothed.every((sample) => sample.continuous !== false) ? [] : ['seam-delta-exceeds-policy'],
  });
}

export function validateSnowReliefContinuity(result) {
  if (!result || result.accepted !== true || !Array.isArray(result.samples)) return false;
  if (!Number.isFinite(result.maxSeamDelta) || result.maxSeamDelta > 0.25) return false;
  return result.samples.every((sample) => Object.values(sample).every((value) => typeof value !== 'number' || Number.isFinite(value)));
}
