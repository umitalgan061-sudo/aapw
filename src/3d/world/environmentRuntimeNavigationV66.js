const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const distance = (a, b) => Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));

export const V66_NAVIGATION_POLICY = Object.freeze({
  id: 'environment-runtime-navigation-v66-2026-09-15',
  version: 66,
  deterministic: true,
  mutation: false,
  maxSlopeWalk: 31,
  maxSlopeSprint: 24,
  waterDepthUnsafe: 0.32,
  roadClearance: 3,
});

export const normalizeNavigationSampleV66 = (sample = {}) => ({
  x: Number(sample.x) || 0,
  z: Number(sample.z) || 0,
  elevation: Number(sample.elevation) || 0,
  slope: clamp(sample.slope, 0, 90),
  waterDepth: clamp(sample.waterDepth),
  waterDistance: Math.max(0, Number(sample.waterDistance) || 99999),
  rockExposure: clamp(sample.rockExposure),
  snow: clamp(sample.snow),
  mud: clamp(sample.mud),
  confidence: clamp(sample.confidence ?? 1),
  roadDistance: Math.max(0, Number(sample.roadDistance) || 99999),
  settlementDistance: Math.max(0, Number(sample.settlementDistance) || 99999),
  biome: sample.biome || 'grassland',
});

export const classifyTraversalV66 = (sample, mode = 'walk') => {
  const s = normalizeNavigationSampleV66(sample);
  const slopeLimit = mode === 'sprint' ? V66_NAVIGATION_POLICY.maxSlopeSprint : V66_NAVIGATION_POLICY.maxSlopeWalk;
  const slopeRisk = clamp(s.slope / slopeLimit);
  const waterRisk = clamp(s.waterDepth / V66_NAVIGATION_POLICY.waterDepthUnsafe);
  const mudRisk = s.mud;
  const snowRisk = s.snow * 0.56;
  const confidenceRisk = 1 - s.confidence;
  const risk = clamp(slopeRisk * 0.36 + waterRisk * 0.24 + mudRisk * 0.18 + snowRisk * 0.12 + confidenceRisk * 0.1);
  const blocked = s.slope > slopeLimit || s.waterDepth > V66_NAVIGATION_POLICY.waterDepthUnsafe || s.confidence < 0.35;
  return {
    mode,
    risk,
    blocked,
    surface: s.waterDepth > 0.03 ? (s.waterDepth > V66_NAVIGATION_POLICY.waterDepthUnsafe ? 'deep-water' : 'shallow-water') : s.mud > 0.52 ? 'mud' : s.snow > 0.7 ? 'snow' : s.rockExposure > 0.62 ? 'rock' : 'ground',
    cost: Number((1 + risk * 4.8).toFixed(4)),
  };
};

export const buildRouteEdgeV66 = (from, to, metadata = {}) => {
  const a = normalizeNavigationSampleV66(from);
  const b = normalizeNavigationSampleV66(to);
  const length = distance(a, b);
  const slopeDelta = Math.abs(a.slope - b.slope) / 45;
  const water = Math.max(a.waterDepth, b.waterDepth);
  const mud = Math.max(a.mud, b.mud);
  const hazard = clamp(metadata.hazard);
  const edge = {
    length,
    slopeDelta,
    water,
    mud,
    hazard,
  };
  const cost = length / 12 + slopeDelta * 3.2 + water * 9 + mud * 2.4 + hazard * 4;
  return {
    ...edge,
    cost: Number(cost.toFixed(4)),
    valid: length > 0 && water <= V66_NAVIGATION_POLICY.waterDepthUnsafe && slopeDelta < 1.4,
    direction: { x: (b.x - a.x) / Math.max(1, length), z: (b.z - a.z) / Math.max(1, length) },
  };
};

export const buildNavigationFieldV66 = ({ samples = [], mode = 'walk' } = {}) => {
  const normalized = samples.map(normalizeNavigationSampleV66);
  return normalized.map((sample, index) => {
    const traversal = classifyTraversalV66(sample, mode);
    const neighbors = normalized
      .map((other, otherIndex) => ({ other, otherIndex, d: distance(sample, other) }))
      .filter((item) => item.otherIndex !== index && item.d > 0 && item.d < 80)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4);
    const links = neighbors.map((item) => buildRouteEdgeV66(sample, item.other, { hazard: 1 - item.other.confidence }));
    return {
      ...sample,
      traversal,
      links,
      reachableNeighbors: links.filter((link) => link.valid).length,
    };
  });
};

export const selectSafeDetourV66 = (current, candidates = [], context = {}) => {
  const scored = candidates.map((candidate) => {
    const sample = normalizeNavigationSampleV66(candidate);
    const traversal = classifyTraversalV66(sample, context.mode || 'walk');
    const progress = distance(current, context.target || sample);
    const routePenalty = clamp(progress / Math.max(1, context.targetDistance || progress || 1));
    return { sample, traversal, score: traversal.blocked ? -Infinity : 1 - traversal.risk - routePenalty * 0.14 };
  }).sort((a, b) => b.score - a.score);
  return scored[0] || null;
};

export const buildPlayerSafetyEnvelopeV66 = ({ samples = [], mode = 'walk' } = {}) => {
  const field = buildNavigationFieldV66({ samples, mode });
  const blocked = field.filter((item) => item.traversal.blocked).length;
  const meanRisk = field.length ? field.reduce((sum, item) => sum + item.traversal.risk, 0) / field.length : 0;
  return {
    mode,
    samples: field.length,
    blocked,
    blockedRatio: field.length ? blocked / field.length : 0,
    meanRisk: Number(meanRisk.toFixed(4)),
    safe: blocked === 0 && meanRisk < 0.58,
    field,
  };
};

export const validateNavigationRuntimeV66 = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_NAVIGATION_POLICY.id) errors.push('policy');
  if (runtime?.deterministic !== true) errors.push('determinism');
  for (const item of runtime?.field || []) {
    if (item.traversal.risk < 0 || item.traversal.risk > 1) errors.push('risk');
    if (item.reachableNeighbors < 0) errors.push('neighbors');
  }
  return { ok: errors.length === 0, errors };
};

export const navigationTelemetryV66 = (runtime) => ({
  samples: runtime?.field?.length || 0,
  blockedRatio: runtime?.blockedRatio || 0,
  meanRisk: runtime?.meanRisk || 0,
  safe: runtime?.safe === true,
});

export const getV66NavigationSummary = () => Object.freeze({
  contract: V66_NAVIGATION_POLICY,
  features: ['traversal-classification', 'route-edge', 'navigation-field', 'safe-detour', 'player-safety-envelope'],
  authority: 'read-only-navigation-facade',
});
