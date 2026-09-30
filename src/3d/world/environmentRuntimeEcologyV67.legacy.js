import { clamp01, meanV67, normalizeSampleV67, seasonPhaseV67 } from './environmentRuntimeV67.js';

export const ECOLOGY_V67 = Object.freeze({
  id: 'ecology-v67',
  version: 67,
  deterministic: true,
  noWorldMutation: true,
});

const BIOME_RULES = Object.freeze({
  alpine: { moisture: .26, canopy: .08, productivity: .32 },
  tundra: { moisture: .34, canopy: .04, productivity: .2 },
  taiga: { moisture: .58, canopy: .72, productivity: .64 },
  forest: { moisture: .66, canopy: .82, productivity: .82 },
  grassland: { moisture: .42, canopy: .16, productivity: .7 },
  scrub: { moisture: .3, canopy: .28, productivity: .48 },
  wetland: { moisture: .86, canopy: .22, productivity: .88 },
  temperate: { moisture: .55, canopy: .58, productivity: .68 },
});

const resourceFit = (actual, target) => clamp01(1 - Math.abs(clamp01(actual) - target) / .8);

export const biomeAffinityV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  const rule = BIOME_RULES[s.biome] ?? BIOME_RULES.temperate;
  return clamp01(
    resourceFit(s.moisture, rule.moisture) * .38 +
    resourceFit(s.canopy, rule.canopy) * .32 +
    rule.productivity * .3,
  );
};

export const soilProductivityV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  return clamp01(
    s.moisture * .34 +
    s.canopy * .18 +
    (1 - s.slope) * .24 +
    (1 - s.humanPressure) * .24,
  );
};

export const habitatResourceV67 = (sample = {}) => ({
  water: clamp01(1 - normalizeSampleV67(sample).waterDistance / 180),
  forage: clamp01(biomeAffinityV67(sample) * .58 + soilProductivityV67(sample) * .42),
  cover: clamp01(normalizeSampleV67(sample).canopy),
});

export const seasonalProductivityV67 = (sample = {}, dayOfYear = 180) => {
  const phase = seasonPhaseV67(dayOfYear);
  const base = soilProductivityV67(sample);
  const multiplier = { winter: .38, spring: .76, summer: 1, autumn: .7 }[phase];
  return clamp01(base * multiplier);
};

export const ecotoneWeightV67 = (left = {}, right = {}) => {
  const a = biomeAffinityV67(left);
  const b = biomeAffinityV67(right);
  return clamp01(Math.abs(a - b) * 1.45);
};

export const regenerationPotentialV67 = (sample = {}, dayOfYear = 180) => {
  const s = normalizeSampleV67(sample);
  return clamp01(
    seasonalProductivityV67(s, dayOfYear) * .55 +
    (1 - s.humanPressure) * .25 +
    (1 - s.slope) * .2,
  );
};

export const buildEcologySampleV67 = (sample = {}, dayOfYear = 180) => {
  const s = normalizeSampleV67(sample);
  const resources = habitatResourceV67(s);
  return {
    id: s.id,
    biome: s.biome,
    affinity: biomeAffinityV67(s),
    productivity: seasonalProductivityV67(s, dayOfYear),
    regeneration: regenerationPotentialV67(s, dayOfYear),
    resources,
    season: seasonPhaseV67(dayOfYear),
  };
};

export const buildEcologyFieldV67 = (samples = [], dayOfYear = 180) =>
  samples.map((sample) => buildEcologySampleV67(sample, dayOfYear));

export const ecologySummaryV67 = (field = []) => ({
  samples: field.length,
  meanAffinity: meanV67(field.map((x) => x.affinity)),
  meanProductivity: meanV67(field.map((x) => x.productivity)),
  meanRegeneration: meanV67(field.map((x) => x.regeneration)),
  lowResource: field.filter((x) => x.resources.forage < .3).length,
});

export const validateEcologyV67 = (field = []) => {
  const errors = [];
  if (!Array.isArray(field)) errors.push('field');
  if (field.some((x) => x.affinity < 0 || x.affinity > 1)) errors.push('affinity');
  if (field.some((x) => x.productivity < 0 || x.productivity > 1)) errors.push('productivity');
  if (field.some((x) => x.resources.forage < 0 || x.resources.forage > 1)) errors.push('resources');
  return { ok: errors.length === 0, errors };
};

export const ecologyTelemetryV67 = (field = []) => ({
  policy: ECOLOGY_V67.id,
  valid: validateEcologyV67(field).ok,
  summary: ecologySummaryV67(field),
});

export const habitatRecoveryWindowV67 = (disturbance = .2, season = 'spring') => {
  const seasonFactor = { winter: 1.8, spring: .9, summer: .7, autumn: 1.1 }[season] ?? 1;
  return Math.max(1, 28 * clamp01(disturbance) * seasonFactor);
};

export const ecologicalPressureV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  return clamp01(s.humanPressure * .62 + (1 - s.canopy) * .1 + s.slope * .1 + (1 - s.moisture) * .18);
};
