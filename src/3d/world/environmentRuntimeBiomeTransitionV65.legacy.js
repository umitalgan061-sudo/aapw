import { buildAdaptiveDecision } from './environmentRuntimeAdaptiveV65.js';

export const V65_ECOTONE_POLICY = Object.freeze({
  id: 'environment-runtime-biome-transition-v65-2026-09-14',
  deterministic: true,
  bandMeters: 140,
  groups: Object.freeze({ cold: ['tundra', 'taiga', 'alpine'], wet: ['wetland', 'riverine', 'coastal'], wooded: ['forest', 'taiga'], open: ['grassland', 'steppe', 'desert'] }),
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const round = (v, p = 4) => Number((Number.isFinite(v) ? v : 0).toFixed(p));
const groupForBiome = (biome) => Object.entries(V65_ECOTONE_POLICY.groups).find(([, values]) => values.includes(biome))?.[0] || 'open';

export const transitionStrength = (left, right, distance = 70) => {
  const leftGroup = groupForBiome(left?.biome || 'grassland');
  const rightGroup = groupForBiome(right?.biome || 'grassland');
  const mismatch = leftGroup === rightGroup ? 0.22 : 0.86;
  const distanceFactor = clamp(1 - Math.max(0, distance) / V65_ECOTONE_POLICY.bandMeters, 0, 1);
  const moistureDelta = Math.abs((left?.moisture ?? 0.5) - (right?.moisture ?? 0.5));
  const elevationDelta = Math.abs((left?.elevation ?? 0) - (right?.elevation ?? 0)) / 1800;
  return round(clamp(mismatch * 0.62 + distanceFactor * 0.28 + moistureDelta * 0.1 + elevationDelta * 0.06, 0, 1));
};

export const habitatMix = (left, right, amount = 0.5) => {
  const a = buildAdaptiveDecision(left).families;
  const b = buildAdaptiveDecision(right).families;
  const t = clamp(amount, 0, 1);
  const map = new Map();
  for (const item of a) map.set(item.family, (map.get(item.family) || 0) + item.runtimeScore * (1 - t));
  for (const item of b) map.set(item.family, (map.get(item.family) || 0) + item.runtimeScore * t);
  const total = [...map.values()].reduce((sum, value) => sum + value, 0) || 1;
  return [...map.entries()].map(([family, score]) => ({ family, weight: round(score / total) })).sort((a, b) => b.weight - a.weight);
};

export const buildEcotone = (left, right, distance = 70) => {
  const strength = transitionStrength(left, right, distance);
  const mix = habitatMix(left, right, 0.5);
  return {
    policy: V65_ECOTONE_POLICY.id,
    leftBiome: left?.biome || 'grassland',
    rightBiome: right?.biome || 'grassland',
    leftGroup: groupForBiome(left?.biome),
    rightGroup: groupForBiome(right?.biome),
    strength,
    bandMeters: round(V65_ECOTONE_POLICY.bandMeters * strength),
    habitatMix: mix.slice(0, 8),
    clearingBias: round(strength * 0.22),
    shrubBridge: strength > 0.42,
    treeDensityBlend: round(1 - strength * 0.45),
    grassDensityBlend: round(0.78 + strength * 0.18),
    groundcoverBlend: round(0.62 + strength * 0.28),
  };
};

export const ecotoneSamples = (left, right, count = 7) => {
  const safeCount = Math.max(2, Math.min(24, Math.floor(count)));
  return Array.from({ length: safeCount }, (_, index) => {
    const t = index / (safeCount - 1);
    const sample = {
      ...left,
      x: (left?.x ?? 0) * (1 - t) + (right?.x ?? 0) * t,
      z: (left?.z ?? 0) * (1 - t) + (right?.z ?? 0) * t,
      elevation: (left?.elevation ?? 0) * (1 - t) + (right?.elevation ?? 0) * t,
      moisture: (left?.moisture ?? 0.5) * (1 - t) + (right?.moisture ?? 0.5) * t,
      temperature: (left?.temperature ?? 0.4) * (1 - t) + (right?.temperature ?? 0.4) * t,
      confidence: Math.min(left?.confidence ?? 0.8, right?.confidence ?? 0.8),
      biome: t < 0.5 ? left?.biome || 'grassland' : right?.biome || 'grassland',
    };
    return { t: round(t), sample, decision: buildAdaptiveDecision(sample, index) };
  });
};

export const transitionDigest = (transition) => {
  let hash = 2166136261;
  for (const char of JSON.stringify(transition)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const validateEcotone = (transition) => {
  const errors = [];
  if (transition?.policy !== V65_ECOTONE_POLICY.id) errors.push('policy');
  if (transition?.strength < 0 || transition?.strength > 1) errors.push('strength');
  if (transition?.bandMeters < 0 || transition?.bandMeters > V65_ECOTONE_POLICY.bandMeters) errors.push('band');
  const total = (transition?.habitatMix || []).reduce((sum, item) => sum + item.weight, 0);
  if (total > 1.02) errors.push('mix-normalization');
  return { ok: errors.length === 0, errors };
};

export const ecotoneTelemetry = (transition) => ({
  policy: V65_ECOTONE_POLICY.id,
  strength: transition?.strength ?? 0,
  bandMeters: transition?.bandMeters ?? 0,
  shrubBridge: transition?.shrubBridge === true,
  treeDensityBlend: transition?.treeDensityBlend ?? 0,
  grassDensityBlend: transition?.grassDensityBlend ?? 0,
  digest: transitionDigest(transition),
});
