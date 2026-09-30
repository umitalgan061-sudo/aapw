const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const round = (v, p = 4) => Number((Number.isFinite(v) ? v : 0).toFixed(p));

export const V65_PHENOLOGY_POLICY = Object.freeze({
  id: 'environment-runtime-phenology-v65-2026-09-14',
  seasons: Object.freeze(['spring', 'summer', 'autumn', 'winter']),
  deterministic: true,
  transitionWidth: 0.12,
});

export const seasonPhase = (dayOfYear = 0) => ((Number.isFinite(dayOfYear) ? dayOfYear : 0) % 365 + 365) % 365 / 365;
export const seasonFromPhase = (phase) => {
  const p = seasonPhase(phase * 365);
  if (p < 0.24) return 'spring';
  if (p < 0.5) return 'summer';
  if (p < 0.76) return 'autumn';
  return 'winter';
};
export const seasonalBlend = (dayOfYear) => {
  const p = seasonPhase(dayOfYear);
  const anchors = { spring: 0.12, summer: 0.37, autumn: 0.62, winter: 0.87 };
  const scores = Object.fromEntries(Object.entries(anchors).map(([name, center]) => {
    let d = Math.abs(p - center);
    d = Math.min(d, 1 - d);
    return [name, clamp(1 - d / 0.24, 0, 1)];
  }));
  const total = Object.values(scores).reduce((a, b) => a + b, 0) || 1;
  return Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, round(v / total)]));
};

export const leafState = ({ biome = 'forest', temperature = 0.5, moisture = 0.5, dayOfYear = 180 } = {}) => {
  const season = seasonalBlend(dayOfYear);
  const stress = clamp((0.38 - temperature) * 0.8 + (0.28 - moisture) * 0.35, 0, 1);
  const evergreen = ['taiga', 'tundra'].includes(biome) ? 0.74 : 0.22;
  return {
    green: round(clamp(season.spring * 0.72 + season.summer * 1 - season.autumn * 0.32 + evergreen, 0, 1) / 1.25),
    yellow: round(clamp(season.autumn * 0.94 + stress * 0.25, 0, 1)),
    bare: round(clamp(season.winter * 0.8 + stress * 0.24 - evergreen * 0.42, 0, 1)),
    frost: round(season.winter * clamp((-temperature + 0.2) / 1.2, 0, 1)),
  };
};

export const undergrowthState = ({ biome = 'grassland', moisture = 0.5, dayOfYear = 180 } = {}) => {
  const s = seasonalBlend(dayOfYear);
  const wet = clamp(moisture, 0, 1);
  const dormant = s.winter * (0.7 + (1 - wet) * 0.18);
  const bloom = s.spring * 0.68 + s.summer * 0.38;
  const lush = s.summer * (0.55 + wet * 0.4) + s.spring * 0.25;
  return {
    lush: round(clamp(lush, 0, 1)),
    bloom: round(clamp(bloom, 0, 1)),
    dormant: round(clamp(dormant, 0, 1)),
    frost: round(s.winter * (1 - wet) * 0.68),
    biomeBias: biome === 'wetland' ? 0.18 : biome === 'desert' ? -0.18 : 0,
  };
};

export const surfaceSeasonalResponse = ({ biome = 'grassland', temperature = 0.5, moisture = 0.5, dayOfYear = 180 } = {}) => {
  const leaves = leafState({ biome, temperature, moisture, dayOfYear });
  const undergrowth = undergrowthState({ biome, moisture, dayOfYear });
  const season = seasonalBlend(dayOfYear);
  return {
    season: seasonFromPhase(seasonalPhase(dayOfYear)),
    blend: season,
    leaves,
    undergrowth,
    runoff: round(season.spring * 0.48 + moisture * 0.28),
    dust: round(season.summer * (1 - moisture) * 0.52),
    frost: round(season.winter * Math.max(leaves.frost, undergrowth.frost)),
  };
};

function seasonalPhase(dayOfYear) { return seasonPhase(dayOfYear); }

export const weatherPulse = ({ dayOfYear = 180, rainfall = 0.2, temperature = 0.5, wind = 0.25 } = {}) => {
  const blend = seasonalBlend(dayOfYear);
  return {
    rain: round(rainfall * (0.58 + blend.spring * 0.32)),
    wind: round(clamp(wind * (0.82 + blend.autumn * 0.3), 0, 1)),
    evaporation: round(clamp((temperature + 1) / 2 * blend.summer * 0.8, 0, 1)),
    snowMelt: round(clamp(blend.spring * (temperature + 0.12) * 0.9, 0, 1)),
  };
};

export const phenologyLod = ({ distance = 0, leaves = {} } = {}) => {
  const d = Math.max(0, distance);
  const changeRate = (leaves.yellow || 0) + (leaves.frost || 0) + Math.abs((leaves.green || 0) - 0.5);
  if (d < 450) return changeRate > 0.45 ? 0 : 1;
  if (d < 1400) return 1;
  if (d < 3200) return 2;
  return 3;
};

export const buildPhenologyField = (samples = [], dayOfYear = 180) => samples.map((sample, index) => {
  const response = surfaceSeasonalResponse({ ...sample, dayOfYear: sample.dayOfYear ?? dayOfYear });
  return {
    id: sample.id || `sample-${index}`,
    x: sample.x || 0,
    z: sample.z || 0,
    ...response,
    lod: phenologyLod({ distance: sample.distance, leaves: response.leaves }),
  };
});

export const crossFadePhenology = (before, after, amount = 0.5) => {
  const t = clamp(amount, 0, 1);
  return {
    green: round((before?.green || 0) * (1 - t) + (after?.green || 0) * t),
    yellow: round((before?.yellow || 0) * (1 - t) + (after?.yellow || 0) * t),
    bare: round((before?.bare || 0) * (1 - t) + (after?.bare || 0) * t),
    frost: round((before?.frost || 0) * (1 - t) + (after?.frost || 0) * t),
  };
};

export const validatePhenology = (field = []) => {
  const errors = [];
  for (const item of field) {
    if (item.lod < 0 || item.lod > 3) errors.push(`${item.id}:lod`);
    for (const key of ['green', 'yellow', 'bare', 'frost']) if (item.leaves[key] < 0 || item.leaves[key] > 1) errors.push(`${item.id}:${key}`);
    const total = Object.values(item.blend || {}).reduce((a, b) => a + b, 0);
    if (Math.abs(total - 1) > 0.02) errors.push(`${item.id}:blend`);
  }
  return { ok: errors.length === 0, errors };
};

export const phenologyDigest = (field = []) => {
  let hash = 2166136261;
  const text = JSON.stringify(field);
  for (const char of text) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const phenologySummary = (field = []) => ({
  sampleCount: field.length,
  green: round(field.reduce((s, x) => s + x.leaves.green, 0) / (field.length || 1)),
  yellow: round(field.reduce((s, x) => s + x.leaves.yellow, 0) / (field.length || 1)),
  dormant: round(field.reduce((s, x) => s + x.undergrowth.dormant, 0) / (field.length || 1)),
  digest: phenologyDigest(field),
});
