const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const weightedMean = (items, key) => items.length ? items.reduce((sum, item) => sum + Number(item[key] || 0), 0) / items.length : 0;

export const V66_ECOLOGY_POLICY = Object.freeze({
  id: 'environment-runtime-ecology-v66-2026-09-15',
  version: 66,
  deterministic: true,
  mutation: false,
  edgeBand: 55,
});

const biomeAffinity = {
  forest: { canopy: 0.9, shrub: 0.62, grass: 0.3, moss: 0.52 },
  taiga: { canopy: 0.78, shrub: 0.54, grass: 0.18, moss: 0.66 },
  wetland: { canopy: 0.22, shrub: 0.6, grass: 0.78, moss: 0.86 },
  riverine: { canopy: 0.46, shrub: 0.72, grass: 0.76, moss: 0.64 },
  coastal: { canopy: 0.16, shrub: 0.58, grass: 0.72, moss: 0.38 },
  alpine: { canopy: 0.06, shrub: 0.38, grass: 0.54, moss: 0.5 },
  tundra: { canopy: 0.01, shrub: 0.34, grass: 0.26, moss: 0.76 },
  steppe: { canopy: 0.03, shrub: 0.4, grass: 0.88, moss: 0.18 },
  grassland: { canopy: 0.02, shrub: 0.28, grass: 0.94, moss: 0.12 },
  desert: { canopy: 0, shrub: 0.36, grass: 0.09, moss: 0 },
};

export const normalizeEcologySampleV66 = (sample = {}) => ({
  x: Number(sample.x) || 0,
  z: Number(sample.z) || 0,
  biome: sample.biome || 'grassland',
  neighborBiome: sample.neighborBiome || null,
  slope: clamp(sample.slope, 0, 90),
  moisture: clamp(sample.moisture),
  temperature: clamp((Number(sample.temperature) || 0.5), 0, 1),
  elevation: Number(sample.elevation) || 0,
  waterDistance: Math.max(0, Number(sample.waterDistance) || 99999),
  disturbance: clamp(sample.disturbance),
  grazing: clamp(sample.grazing),
});

export const computeEcotoneV66 = (sample = {}) => {
  const s = normalizeEcologySampleV66(sample);
  const same = !s.neighborBiome || s.neighborBiome === s.biome;
  const own = biomeAffinity[s.biome] || biomeAffinity.grassland;
  const other = biomeAffinity[s.neighborBiome] || own;
  const contrast = clamp((Math.abs(own.canopy - other.canopy) + Math.abs(own.grass - other.grass) + Math.abs(own.moss - other.moss)) / 2);
  const moistureBand = clamp(1 - Math.abs(s.moisture - 0.62) / 0.72);
  const slopeBand = clamp(1 - Math.abs(s.slope - 14) / 44);
  const strength = same ? 0 : clamp(contrast * 0.56 + moistureBand * 0.24 + slopeBand * 0.2);
  return {
    strength,
    band: strength > 0.72 ? 'broad' : strength > 0.42 ? 'moderate' : strength > 0.18 ? 'narrow' : 'quiet',
    transition: same ? 'interior' : `${s.biome}-to-${s.neighborBiome}`,
    clearingBias: clamp((1 - own.canopy) * 0.35 + s.disturbance * 0.45 + s.grazing * 0.2),
    edgeShrubBias: clamp(other.shrub * strength * 0.72 + own.shrub * 0.28),
    edgeGrassBias: clamp(other.grass * strength * 0.7 + own.grass * 0.3),
    edgeMossBias: clamp(other.moss * strength * 0.66 + own.moss * 0.34),
  };
};

export const buildVegetationLayerWeightsV66 = (sample = {}) => {
  const s = normalizeEcologySampleV66(sample);
  const base = biomeAffinity[s.biome] || biomeAffinity.grassland;
  const ecotone = computeEcotoneV66(s);
  const moisture = s.moisture;
  const warmth = s.temperature;
  const weights = {
    canopy: base.canopy * (0.55 + warmth * 0.45) * (1 - s.slope / 120),
    shrub: base.shrub * (0.6 + ecotone.edgeShrubBias * 0.4),
    grass: base.grass * (0.5 + moisture * 0.5) * (1 - ecotone.clearingBias * 0.2),
    moss: base.moss * (0.52 + moisture * 0.48),
    bare: clamp(s.disturbance * 0.56 + (1 - moisture) * 0.18 + s.slope / 90 * 0.26),
  };
  const total = Object.values(weights).reduce((sum, item) => sum + Math.max(0, item), 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, clamp(value / total)]));
};

export const buildHabitatResourcesV66 = (sample = {}, hydrology = {}, erosion = {}) => {
  const s = normalizeEcologySampleV66(sample);
  const vegetation = buildVegetationLayerWeightsV66(s);
  const flow = clamp(hydrology.discharge ? hydrology.discharge / 10 : hydrology.flow);
  const sediment = clamp(erosion.sediment);
  return {
    forage: clamp(vegetation.grass * 0.55 + vegetation.shrub * 0.3 + moistureBonus(s.moisture) * 0.15),
    cover: clamp(vegetation.canopy * 0.56 + vegetation.shrub * 0.3 + vegetation.moss * 0.14),
    mineral: clamp((1 - vegetation.canopy) * 0.34 + sediment * 0.46 + s.slope / 90 * 0.2),
    water: clamp((1 - s.waterDistance / 240) * 0.62 + flow * 0.38),
    winterRefuge: clamp(vegetation.canopy * 0.34 + vegetation.shrub * 0.28 + (1 - s.temperature) * 0.38),
  };
};

function moistureBonus(value) { return clamp(value * 0.8 + 0.2); }

export const buildSeasonalEcologyV66 = ({ samples = [], season = 'summer' } = {}) => {
  const factors = { spring: { forage: 1, cover: 0.72, water: 0.92 }, summer: { forage: 0.92, cover: 1, water: 0.78 }, autumn: { forage: 0.68, cover: 0.84, water: 0.74 }, winter: { forage: 0.26, cover: 0.52, water: 0.64 } };
  const factor = factors[season] || factors.summer;
  const layers = samples.map((sample) => {
    const weights = buildVegetationLayerWeightsV66(sample);
    return { resources: buildHabitatResourcesV66(sample), weights, forage: clamp(weights.grass * factor.forage), cover: clamp((weights.canopy + weights.shrub) * factor.cover), water: factor.water };
  });
  return { season, count: layers.length, layers, meanForage: weightedMean(layers, 'forage'), meanCover: weightedMean(layers, 'cover') };
};

export const validateEcologyRuntimeV66 = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_ECOLOGY_POLICY.id) errors.push('policy');
  if (runtime?.deterministic !== true) errors.push('determinism');
  for (const layer of runtime?.layers || []) {
    const total = Object.values(layer.weights || {}).reduce((sum, item) => sum + item, 0);
    if (Math.abs(total - 1) > 0.03) errors.push('weights');
  }
  return { ok: errors.length === 0, errors };
};

export const ecologyTelemetryV66 = (runtime) => ({
  samples: runtime?.count || 0,
  meanForage: Number((runtime?.meanForage || 0).toFixed(4)),
  meanCover: Number((runtime?.meanCover || 0).toFixed(4)),
  season: runtime?.season || 'unknown',
});

export const getV66EcologySummary = () => Object.freeze({
  contract: V66_ECOLOGY_POLICY,
  features: ['biome-ecotone', 'vegetation-layering', 'habitat-resources', 'seasonal-ecology'],
  authority: 'read-only-ecology-response',
});
