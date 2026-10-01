const clamp01 = (value) => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0));
const clamp = (value, min, max) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));
const round = (value) => Math.round((Number.isFinite(value) ? value : 0) * 1e6) / 1e6;

function hash(value) {
  let h = 2166136261;
  for (const char of String(value)) {
    h ^= char.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(freeze);
  return value;
}

const BIOME_GROUPS = Object.freeze({
  cold: Object.freeze(['taiga', 'alpine', 'tundra']),
  wet: Object.freeze(['wetland', 'riverine', 'coastal']),
  open: Object.freeze(['steppe', 'grassland', 'desert']),
  wooded: Object.freeze(['forest', 'temperate']),
});

function groupForBiome(biome) {
  for (const [group, values] of Object.entries(BIOME_GROUPS)) if (values.includes(biome)) return group;
  return 'unknown';
}

export function createBiomeEcotoneTransitionV64({
  biome = 'unknown',
  adjacentBiomes = [],
  moisture = 0.5,
  elevation01 = 0.5,
  snowWeight = 0,
  slopeDegrees = 0,
  waterDistance = 500,
  relief = 0.5,
  seed = 'v64-ecotone',
} = {}) {
  const current = String(biome).toLowerCase();
  const group = groupForBiome(current);
  const neighbours = Array.isArray(adjacentBiomes) ? adjacentBiomes.map((item) => String(item).toLowerCase()).slice(0, 8) : [];
  const neighbourGroups = neighbours.map(groupForBiome);
  const groupCounts = neighbourGroups.reduce((acc, item) => { acc[item] = (acc[item] ?? 0) + 1; return acc; }, {});
  const dominantNeighbour = Object.entries(groupCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? group;
  const transitionStrength = clamp01((neighbourGroups.length ? 0.18 + (dominantNeighbour !== group ? 0.26 : 0.04) : 0.08) + relief * 0.26 + Math.abs(slopeDegrees) / 120);
  const wetSignal = clamp01(moisture * 0.72 + (waterDistance < 80 ? 0.24 : 0));
  const coldSignal = clamp01(Math.max(snowWeight, elevation01 * 0.78));
  const openSignal = clamp01(1 - moisture * 0.72);
  const canopy = group === 'wooded' ? 0.78 : group === 'cold' ? 0.42 : group === 'open' ? 0.24 : 0.34;
  const shrub = clamp01(0.18 + wetSignal * 0.2 + transitionStrength * 0.26);
  const grass = clamp01(0.3 + openSignal * 0.42 + (group === 'wet' ? 0.08 : 0));
  const rock = clamp01((slopeDegrees - 24) / 48 + relief * 0.24 + coldSignal * 0.08);
  const snowEdge = clamp01(coldSignal * (0.58 + relief * 0.3));
  const wetEdge = clamp01(wetSignal * (0.42 + transitionStrength * 0.44));
  const total = canopy + shrub + grass + rock + snowEdge + wetEdge || 1;
  const weights = Object.freeze({
    canopy: round(canopy / total),
    shrub: round(shrub / total),
    grass: round(grass / total),
    rock: round(rock / total),
    snowEdge: round(snowEdge / total),
    wetEdge: round(wetEdge / total),
  });
  return freeze({
    currentBiome: current,
    currentGroup: group,
    dominantNeighbourGroup: dominantNeighbour,
    transitionStrength: round(transitionStrength),
    transitionBandMeters: round(12 + transitionStrength * 48),
    weights,
    clearingBias: round(clamp01((1 - weights.canopy) * (0.34 + openSignal * 0.42))),
    ecotone: freeze({
      forestToShrub: group === 'wooded' && dominantNeighbour === 'open',
      woodlandEdge: group === 'wooded' && dominantNeighbour !== 'wooded',
      coldEdge: group === 'cold' && dominantNeighbour !== 'cold',
      wetEdge: group === 'wet' || waterDistance < 80,
      alpineRockEdge: slopeDegrees > 36 && coldSignal > 0.55,
    }),
    worldSpace: true,
    deterministic: true,
    regularGrid: false,
    fingerprint: hash(JSON.stringify({ current, group, neighbours, weights, transitionStrength, seed })),
  });
}

export function validateBiomeEcotoneTransitionV64(result) {
  const errors = [];
  const weights = result?.weights ?? {};
  const total = Object.values(weights).reduce((sum, value) => sum + value, 0);
  if (Math.abs(total - 1) > 0.02) errors.push('weights-not-normalized');
  if (result?.transitionStrength < 0 || result?.transitionStrength > 1) errors.push('transition-out-of-range');
  if (result?.transitionBandMeters < 12 || result?.transitionBandMeters > 60) errors.push('band-out-of-range');
  if (result?.regularGrid !== false) errors.push('regular-grid');
  return freeze({ valid: errors.length === 0, errors: Object.freeze(errors) });
}

export function compareBiomeEcotoneTransitionsV64(first, second) {
  return freeze({
    deterministic: first?.fingerprint === second?.fingerprint,
    transitionDelta: round((second?.transitionStrength ?? 0) - (first?.transitionStrength ?? 0)),
    sameBiome: first?.currentBiome === second?.currentBiome,
    sameNeighbourGroup: first?.dominantNeighbourGroup === second?.dominantNeighbourGroup,
  });
}
