const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const hash = (seed, text) => { let h = (2166136261 ^ seed) >>> 0; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const distance = (a, b) => Math.hypot((a.x || 0) - (b.x || 0), (a.z || 0) - (b.z || 0));

export const V66_WILDLIFE_POLICY = Object.freeze({
  id: 'environment-runtime-wildlife-v66-2026-09-15',
  version: 66,
  deterministic: true,
  mutation: false,
  maxAgentsPerTile: 18,
  scentRange: 75,
  quietHours: [21, 5],
});

export const normalizeHabitatV66 = (sample = {}) => ({
  x: Number(sample.x) || 0,
  z: Number(sample.z) || 0,
  biome: sample.biome || 'grassland',
  elevation: Number(sample.elevation) || 0,
  slope: clamp(sample.slope, 0, 90),
  moisture: clamp(sample.moisture),
  vegetation: clamp(sample.vegetationCover ?? sample.vegetation),
  waterDistance: Math.max(0, Number(sample.waterDistance) || 99999),
  roadDistance: Math.max(0, Number(sample.roadDistance) || 99999),
  settlementDistance: Math.max(0, Number(sample.settlementDistance) || 99999),
  snow: clamp(sample.snow),
  noise: clamp(sample.noise),
  confidence: clamp(sample.confidence ?? 1),
});

const speciesRules = {
  elk: { biomes: ['forest', 'taiga', 'grassland'], water: 0.7, cover: 0.52, slope: 34, road: 65, settlement: 140, nocturnal: 0.35 },
  wolf: { biomes: ['forest', 'taiga', 'tundra', 'grassland'], water: 0.45, cover: 0.38, slope: 46, road: 95, settlement: 240, nocturnal: 0.76 },
  ibex: { biomes: ['alpine', 'tundra'], water: 0.28, cover: 0.18, slope: 62, road: 42, settlement: 180, nocturnal: 0.6 },
  boar: { biomes: ['forest', 'wetland', 'grassland'], water: 0.8, cover: 0.64, slope: 36, road: 55, settlement: 90, nocturnal: 0.68 },
  fox: { biomes: ['forest', 'taiga', 'grassland', 'tundra'], water: 0.35, cover: 0.28, slope: 44, road: 40, settlement: 80, nocturnal: 0.82 },
  crane: { biomes: ['wetland', 'riverine', 'coastal'], water: 0.94, cover: 0.2, slope: 12, road: 35, settlement: 110, nocturnal: 0.2 },
};

export const scoreSpeciesHabitatV66 = (species, sample, time = 12, weather = {}) => {
  const s = normalizeHabitatV66(sample);
  const rule = speciesRules[species];
  if (!rule) return { score: 0, eligible: false, reasons: ['unknown-species'] };
  const hour = ((Number(time) || 0) % 24 + 24) % 24;
  const night = hour >= V66_WILDLIFE_POLICY.quietHours[0] || hour < V66_WILDLIFE_POLICY.quietHours[1];
  const biome = rule.biomes.includes(s.biome) ? 1 : 0;
  const water = 1 - clamp(Math.abs(s.waterDistance - rule.water * 80) / 120);
  const cover = 1 - clamp(Math.abs(s.vegetation - rule.cover) / 0.8);
  const slope = 1 - clamp(Math.abs(s.slope - rule.slope * 0.55) / 45);
  const road = clamp(s.roadDistance / Math.max(1, rule.road));
  const settlement = clamp(s.settlementDistance / Math.max(1, rule.settlement));
  const quiet = night === (rule.nocturnal > 0.5) ? 1 : 0.46;
  const storm = clamp(weather.storm ?? 0);
  const visibility = 1 - storm * (species === 'crane' ? 0.38 : 0.2);
  const score = clamp(biome * 0.28 + water * 0.13 + cover * 0.16 + slope * 0.11 + road * 0.11 + settlement * 0.1 + quiet * 0.07 + visibility * 0.04);
  const reasons = [];
  if (!biome) reasons.push('biome');
  if (s.roadDistance < rule.road * 0.45) reasons.push('road-buffer');
  if (s.settlementDistance < rule.settlement * 0.45) reasons.push('settlement-buffer');
  if (s.confidence < 0.55) reasons.push('low-confidence');
  return { score, eligible: score >= 0.48 && reasons.length === 0, reasons, activity: night ? 'nocturnal' : 'diurnal' };
};

export const chooseHabitatSpeciesV66 = (sample, { species = Object.keys(speciesRules), time = 12, weather = {} } = {}) => {
  const scored = species.map((id) => ({ species: id, ...scoreSpeciesHabitatV66(id, sample, time, weather) }));
  scored.sort((a, b) => b.score - a.score || a.species.localeCompare(b.species));
  return { selected: scored[0]?.species || null, candidates: scored, deterministic: true };
};

export const buildWildlifeCorridorV66 = ({ samples = [], seed = 66, time = 12, weather = {}, species = Object.keys(speciesRules) } = {}) => {
  const habitats = samples.map(normalizeHabitatV66);
  const corridors = [];
  for (let i = 0; i < habitats.length; i += 1) {
    const chosen = chooseHabitatSpeciesV66(habitats[i], { species, time, weather });
    if (!chosen.selected) continue;
    const speciesSeed = hash(seed, `${chosen.selected}:${habitats[i].x}:${habitats[i].z}`);
    const phase = (speciesSeed % 1000) / 1000;
    corridors.push({
      species: chosen.selected,
      x: habitats[i].x,
      z: habitats[i].z,
      activity: chosen.candidates[0].activity,
      density: Number((0.25 + chosen.candidates[0].score * 0.75).toFixed(4)),
      pathBias: { x: Number((phase * 2 - 1).toFixed(4)), z: Number(((1 - phase) * 2 - 1).toFixed(4)) },
      score: Number(chosen.candidates[0].score.toFixed(4)),
      sourceIndex: i,
    });
  }
  return { policy: V66_WILDLIFE_POLICY.id, deterministic: true, corridors };
};

export const avoidHumanInfrastructureV66 = (point, infrastructure = {}) => {
  const p = normalizeHabitatV66(point);
  const roads = infrastructure.roads || [];
  const settlements = infrastructure.settlements || [];
  const nearestRoad = roads.length ? Math.min(...roads.map((road) => distance(p, road))) : 99999;
  const nearestSettlement = settlements.length ? Math.min(...settlements.map((item) => distance(p, item))) : 99999;
  const roadPenalty = clamp(1 - nearestRoad / 120);
  const settlementPenalty = clamp(1 - nearestSettlement / 220);
  return {
    roadDistance: nearestRoad,
    settlementDistance: nearestSettlement,
    avoidance: clamp(roadPenalty * 0.48 + settlementPenalty * 0.52),
    safe: nearestRoad >= 28 && nearestSettlement >= 65,
  };
};

export const buildMigrationLinkV66 = (from, to, hazards = {}) => {
  const a = normalizeHabitatV66(from);
  const b = normalizeHabitatV66(to);
  const length = distance(a, b);
  const slopeCost = Math.abs(a.slope - b.slope) / 50;
  const waterCost = Math.abs(a.waterDistance - b.waterDistance) / 100;
  const roadHazard = clamp(hazards.road ?? 0);
  const settlementHazard = clamp(hazards.settlement ?? 0);
  const cost = length / 1000 + slopeCost * 0.18 + waterCost * 0.12 + roadHazard * 0.3 + settlementHazard * 0.42;
  return {
    valid: length > 0 && cost < 2.5,
    cost: Number(cost.toFixed(5)),
    length: Number(length.toFixed(2)),
    direction: { x: (b.x - a.x) / Math.max(1, length), z: (b.z - a.z) / Math.max(1, length) },
  };
};

export const validateWildlifeRuntimeV66 = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_WILDLIFE_POLICY.id) errors.push('policy');
  if (runtime?.deterministic !== true) errors.push('determinism');
  for (const entry of runtime?.corridors || []) {
    if (!speciesRules[entry.species]) errors.push('species');
    if (entry.density < 0 || entry.density > 1) errors.push('density');
    if (Math.abs(entry.pathBias.x) > 1 || Math.abs(entry.pathBias.z) > 1) errors.push('path');
  }
  return { ok: errors.length === 0, errors };
};

export const wildlifeTelemetryV66 = (runtime) => {
  const items = runtime?.corridors || [];
  const species = [...new Set(items.map((item) => item.species))];
  return {
    corridorCount: items.length,
    speciesCount: species.length,
    species,
    meanDensity: items.length ? Number((items.reduce((sum, item) => sum + item.density, 0) / items.length).toFixed(4)) : 0,
    nocturnalShare: items.length ? Number((items.filter((item) => item.activity === 'nocturnal').length / items.length).toFixed(4)) : 0,
  };
};

export const getV66WildlifeSummary = () => Object.freeze({
  contract: V66_WILDLIFE_POLICY,
  species: Object.keys(speciesRules),
  features: ['habitat-score', 'wildlife-corridor', 'human-avoidance', 'migration-link'],
  authority: 'read-only-ecology-intent',
});
