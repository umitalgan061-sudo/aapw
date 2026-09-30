/**
 * Groundwater regime catalog and deterministic preset library.
 *
 * Presets are authored visualization contexts, not alternate maps. Each
 * preset changes only environmental inputs consumed by the render-only layer.
 */
import { TERRAIN_GROUNDWATER_POLICY, normalizeGroundwaterSample, resolveTerrainGroundwaterState, terrainGroundwaterSignature } from './terrainGroundwaterRegime.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const lerp = (a, b, t) => a + (b - a) * t;
const freeze = Object.freeze;

export const TERRAIN_GROUNDWATER_PRESET_POLICY = freeze({
  id: 'terrain-groundwater-preset-catalog-2026-09-15-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
  deterministic: true,
  renderOnly: true,
  presetCount: 24,
  seasonCount: 12,
  substrateCount: 8,
});

const SUBSTRATE_PROFILES = freeze({
  loam: freeze({ permeability: 0.48, soilDepth: 1.25, drainage: 0.46 }),
  clay: freeze({ permeability: 0.20, soilDepth: 1.40, drainage: 0.26 }),
  sand: freeze({ permeability: 0.86, soilDepth: 0.70, drainage: 0.72 }),
  gravel: freeze({ permeability: 0.96, soilDepth: 0.48, drainage: 0.88 }),
  peat: freeze({ permeability: 0.34, soilDepth: 2.40, drainage: 0.30 }),
  marl: freeze({ permeability: 0.42, soilDepth: 1.10, drainage: 0.40 }),
  shale: freeze({ permeability: 0.16, soilDepth: 0.54, drainage: 0.58 }),
  limestone: freeze({ permeability: 0.60, soilDepth: 0.86, drainage: 0.67 }),
});

const BIOME_PROFILES = freeze({
  temperate: freeze({ rainfall: 0.61, moisture: 0.56, temperatureC: 12 }),
  mediterranean: freeze({ rainfall: 0.39, moisture: 0.42, temperatureC: 17 }),
  alpine: freeze({ rainfall: 0.68, moisture: 0.57, temperatureC: 4 }),
  boreal: freeze({ rainfall: 0.59, moisture: 0.64, temperatureC: 6 }),
  steppe: freeze({ rainfall: 0.31, moisture: 0.30, temperatureC: 14 }),
  humid: freeze({ rainfall: 0.78, moisture: 0.72, temperatureC: 18 }),
  monsoon: freeze({ rainfall: 0.86, moisture: 0.68, temperatureC: 23 }),
  coastal: freeze({ rainfall: 0.66, moisture: 0.62, temperatureC: 16 }),
});

const SEASON_PRESETS = freeze([
  freeze({ id: 'deep-winter', dayStart: 0, dayEnd: 29, rainfall: 0.60, temperatureC: 1 }),
  freeze({ id: 'late-winter', dayStart: 30, dayEnd: 59, rainfall: 0.65, temperatureC: 4 }),
  freeze({ id: 'early-spring', dayStart: 60, dayEnd: 89, rainfall: 0.72, temperatureC: 8 }),
  freeze({ id: 'spring', dayStart: 90, dayEnd: 119, rainfall: 0.78, temperatureC: 13 }),
  freeze({ id: 'late-spring', dayStart: 120, dayEnd: 149, rainfall: 0.70, temperatureC: 17 }),
  freeze({ id: 'early-summer', dayStart: 150, dayEnd: 179, rainfall: 0.56, temperatureC: 21 }),
  freeze({ id: 'summer', dayStart: 180, dayEnd: 209, rainfall: 0.42, temperatureC: 25 }),
  freeze({ id: 'late-summer', dayStart: 210, dayEnd: 239, rainfall: 0.36, temperatureC: 24 }),
  freeze({ id: 'early-autumn', dayStart: 240, dayEnd: 269, rainfall: 0.47, temperatureC: 19 }),
  freeze({ id: 'autumn', dayStart: 270, dayEnd: 299, rainfall: 0.60, temperatureC: 14 }),
  freeze({ id: 'late-autumn', dayStart: 300, dayEnd: 329, rainfall: 0.68, temperatureC: 9 }),
  freeze({ id: 'pre-winter', dayStart: 330, dayEnd: 359, rainfall: 0.63, temperatureC: 4 }),
]);

const PRESET_ROWS = [
  ['temperate-loam-valley', 'temperate', 'loam', 0.34, 18],
  ['temperate-clay-basin', 'temperate', 'clay', 0.28, 12],
  ['temperate-sand-terrace', 'temperate', 'sand', 0.52, 26],
  ['temperate-peat-marsh-edge', 'humid', 'peat', 0.18, 7],
  ['alpine-gravel-fan', 'alpine', 'gravel', 0.62, 34],
  ['alpine-shale-slope', 'alpine', 'shale', 0.44, 52],
  ['mediterranean-marl-bench', 'mediterranean', 'marl', 0.36, 21],
  ['mediterranean-limestone-karst', 'mediterranean', 'limestone', 0.51, 39],
  ['steppe-clay-pan', 'steppe', 'clay', 0.22, 9],
  ['steppe-sand-wash', 'steppe', 'sand', 0.58, 31],
  ['humid-loam-footwall', 'humid', 'loam', 0.25, 16],
  ['humid-peat-flat', 'humid', 'peat', 0.15, 5],
  ['monsoon-clay-fan', 'monsoon', 'clay', 0.31, 17],
  ['monsoon-sand-bar', 'monsoon', 'sand', 0.49, 28],
  ['coastal-loam-dune', 'coastal', 'loam', 0.42, 14],
  ['coastal-sand-swale', 'coastal', 'sand', 0.38, 4],
  ['boreal-loam-hollow', 'boreal', 'loam', 0.23, 13],
  ['boreal-peat-margin', 'boreal', 'peat', 0.12, 6],
  ['boreal-gravel-outwash', 'boreal', 'gravel', 0.66, 24],
  ['alpine-limestone-shelf', 'alpine', 'limestone', 0.54, 42],
  ['temperate-shale-bench', 'temperate', 'shale', 0.47, 33],
  ['humid-marl-lowland', 'humid', 'marl', 0.19, 10],
  ['monsoon-loam-gentle-fan', 'monsoon', 'loam', 0.27, 19],
  ['coastal-limestone-runoff', 'coastal', 'limestone', 0.58, 37],
];

export const TERRAIN_GROUNDWATER_PRESETS = freeze(PRESET_ROWS.map(([id, biome, substrate, drainage, groundwaterDepthMeters]) => freeze({ id, biome, substrate, drainage, groundwaterDepthMeters, sourcePolicyId: TERRAIN_GROUNDWATER_PRESET_POLICY.sourcePolicyId })));

export function findGroundwaterPreset(id) { return TERRAIN_GROUNDWATER_PRESETS.find((preset) => preset.id === id) ?? null; }

export function seasonForDay(dayOfYear) {
  const day = ((Math.floor(Number(dayOfYear) || 0) % 360) + 360) % 360;
  return SEASON_PRESETS.find((season) => day >= season.dayStart && day <= season.dayEnd) ?? SEASON_PRESETS[0];
}

export function seasonInput(dayOfYear) {
  const season = seasonForDay(dayOfYear);
  return freeze({ id: season.id, dayOfYear: ((Math.floor(Number(dayOfYear) || 0) % 360) + 360) % 360, rainfall: season.rainfall, temperatureC: season.temperatureC });
}

export function presetInput(id, overrides = {}) {
  const preset = findGroundwaterPreset(id);
  if (!preset) throw new RangeError(`unknown groundwater preset: ${id}`);
  const biome = BIOME_PROFILES[preset.biome] ?? BIOME_PROFILES.temperate;
  const substrate = SUBSTRATE_PROFILES[preset.substrate] ?? SUBSTRATE_PROFILES.loam;
  return normalizeGroundwaterSample({
    worldX: 0,
    worldZ: 0,
    heightMeters: preset.groundwaterDepthMeters > 20 ? 74 : 18,
    slopeDegrees: preset.groundwaterDepthMeters > 30 ? 18 : 6,
    moisture: biome.moisture,
    rainfall: biome.rainfall,
    runoff: clamp01((1 - preset.drainage) * 0.58),
    soilDepth: substrate.soilDepth,
    permeability: substrate.permeability,
    waterDistanceMeters: 42 + preset.groundwaterDepthMeters * 1.6,
    groundwaterDepthMeters: preset.groundwaterDepthMeters,
    wetDays: preset.groundwaterDepthMeters < 16 ? 18 : 7,
    dryDays: preset.groundwaterDepthMeters > 35 ? 24 : 5,
    temperatureC: biome.temperatureC,
    drainage: preset.drainage,
    substrate: preset.substrate,
    biome: preset.biome,
    ...overrides,
  });
}

export function resolveGroundwaterPreset(id, overrides = {}) { return resolveTerrainGroundwaterState(presetInput(id, overrides)); }
export function presetSignature(id, overrides = {}) { return terrainGroundwaterSignature(presetInput(id, overrides)); }

export function sampleAllPresetSignatures(dayOfYear = 135) {
  return freeze(TERRAIN_GROUNDWATER_PRESETS.map((preset) => ({ id: preset.id, season: seasonForDay(dayOfYear).id, signature: presetSignature(preset.id, { dayOfYear }) })));
}

export function interpolatePreset(aId, bId, mix = 0.5, overrides = {}) {
  const a = presetInput(aId, overrides);
  const b = presetInput(bId, overrides);
  const t = clamp01(mix);
  return normalizeGroundwaterSample({
    ...a,
    moisture: lerp(a.moisture, b.moisture, t),
    rainfall: lerp(a.rainfall, b.rainfall, t),
    runoff: lerp(a.runoff, b.runoff, t),
    soilDepth: lerp(a.soilDepth, b.soilDepth, t),
    permeability: lerp(a.permeability, b.permeability, t),
    waterDistanceMeters: lerp(a.waterDistanceMeters, b.waterDistanceMeters, t),
    groundwaterDepthMeters: lerp(a.groundwaterDepthMeters, b.groundwaterDepthMeters, t),
    wetDays: lerp(a.wetDays, b.wetDays, t),
    dryDays: lerp(a.dryDays, b.dryDays, t),
    temperatureC: lerp(a.temperatureC, b.temperatureC, t),
    drainage: lerp(a.drainage, b.drainage, t),
    ...overrides,
  });
}

export function groundwaterPresetMatrix({ dayStep = 30, origins = [{ worldX: 0, worldZ: 0 }, { worldX: 260, worldZ: -180 }] } = {}) {
  const step = clamp(Math.floor(dayStep), 1, 180);
  const rows = [];
  for (const preset of TERRAIN_GROUNDWATER_PRESETS) {
    for (const origin of origins) {
      for (let day = 0; day < 360; day += step) {
        const state = resolveGroundwaterPreset(preset.id, { worldX: origin.worldX, worldZ: origin.worldZ, dayOfYear: day });
        rows.push(freeze({ presetId: preset.id, worldX: origin.worldX, worldZ: origin.worldZ, day, season: seasonForDay(day).id, wetness: state.surfaceFilm, saturation: state.surfaceSaturation, seepage: state.seepageFace, capillary: state.capillaryRise, puddle: state.puddlePersistence, marsh: state.marshEdgeFactor }));
      }
    }
  }
  return freeze(rows);
}

export function rankGroundwaterPresets({ metric = 'surfaceFilm', dayOfYear = 135 } = {}) {
  const allowed = new Set(['surfaceFilm','surfaceSaturation','seepageFace','capillaryRise','puddlePersistence','marshEdgeFactor','dryingResistance']);
  if (!allowed.has(metric)) throw new RangeError(`unsupported groundwater metric: ${metric}`);
  return freeze(TERRAIN_GROUNDWATER_PRESETS.map((preset) => ({ id: preset.id, value: resolveGroundwaterPreset(preset.id, { dayOfYear })[metric] })).sort((a, b) => b.value - a.value));
}

export function compareSubstratesAtLocation({ worldX = 0, worldZ = 0, dayOfYear = 180 } = {}) {
  const rows = [];
  for (const substrate of Object.keys(SUBSTRATE_PROFILES)) {
    const profile = SUBSTRATE_PROFILES[substrate];
    const state = resolveTerrainGroundwaterState({ worldX, worldZ, heightMeters: 35, slopeDegrees: 8, moisture: 0.52, rainfall: 0.56, runoff: 0.16, groundwaterDepthMeters: 17, waterDistanceMeters: 46, wetDays: 12, dryDays: 4, temperatureC: 18, drainage: profile.drainage, permeability: profile.permeability, soilDepth: profile.soilDepth, substrate, dayOfYear });
    rows.push(freeze({ substrate, permeability: profile.permeability, drainage: profile.drainage, film: state.surfaceFilm, saturation: state.surfaceSaturation, capillary: state.capillaryRise }));
  }
  return freeze(rows);
}
