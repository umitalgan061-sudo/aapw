/**
 * Terrain groundwater render adapter.
 *
 * Converts the deterministic groundwater regime into a bounded set of
 * surface-layer channels. This is intentionally decoupled from simulation:
 * callers can sample it per tile/material without creating persistent water.
 */
import {
  TERRAIN_GROUNDWATER_POLICY,
  resolveTerrainGroundwaterState,
  groundwaterMaterialResponse,
  validateTerrainGroundwaterState,
} from './terrainGroundwaterRegime.js';

const clamp01 = (v) => Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
const lerp = (a, b, t) => a + (b - a) * t;
const freeze = (value) => Object.freeze(value);

export const TERRAIN_GROUNDWATER_ADAPTER_POLICY = freeze({
  id: 'terrain-groundwater-surface-adapter-2026-09-15-v1',
  materialKey: 'terrain-groundwater-surface-adapter-v1',
  sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
  renderOnly: true,
  deterministic: true,
  canonicalHeightUnchanged: true,
  canonicalHydrologyUnchanged: true,
  channelCount: 14,
  maxCombinedAlbedoShift: 0.12,
  maxCombinedRoughnessShift: 0.12,
  maxCombinedNormalStrength: 0.08,
});

const CHANNELS = [
  'wetness','surfaceFilm','waterTableProximity','capillaryRise','seepageFace','saturation','memory','dryingResistance','puddlePersistence','marshEdge','fineTransport','saltRing','freezeWetness','dryingDemand',
];

export const TERRAIN_GROUNDWATER_CHANNELS = Object.freeze(CHANNELS);

function numeric(v, fallback = 0) { return Number.isFinite(Number(v)) ? Number(v) : fallback; }

export function groundwaterChannelsFromState(state) {
  const validation = validateTerrainGroundwaterState(state);
  if (!validation.ok) throw new TypeError(`invalid groundwater state: ${validation.errors.join(',')}`);
  const stress = state.stress ?? {};
  const mineral = state.mineralMobilization ?? {};
  return freeze({
    wetness: clamp01(state.surfaceFilm * 0.62 + state.seepageFace * 0.22 + state.puddlePersistence * 0.16),
    surfaceFilm: clamp01(state.surfaceFilm),
    waterTableProximity: clamp01(state.waterTableProximity),
    capillaryRise: clamp01(state.capillaryRise),
    seepageFace: clamp01(state.seepageFace),
    saturation: clamp01(state.surfaceSaturation),
    memory: clamp01(state.saturationMemory),
    dryingResistance: clamp01(state.dryingResistance),
    puddlePersistence: clamp01(state.puddlePersistence),
    marshEdge: clamp01(state.marshEdgeFactor),
    fineTransport: clamp01(mineral.fineTransport ?? 0),
    saltRing: clamp01(mineral.saltRing ?? 0),
    freezeWetness: clamp01(stress.freezeStress ?? 0),
    dryingDemand: clamp01(1 - state.dryingResistance),
  });
}

export function resolveGroundwaterSurfaceFrame(input = {}) {
  const state = resolveTerrainGroundwaterState(input);
  const channels = groundwaterChannelsFromState(state);
  const material = groundwaterMaterialResponse({ state, baseColor: input.baseColor ?? { r: 0.5, g: 0.42, b: 0.32 }, baseRoughness: numeric(input.baseRoughness, 0.86) });
  return freeze({
    policyId: TERRAIN_GROUNDWATER_ADAPTER_POLICY.id,
    sourcePolicyId: state.policyId,
    state,
    channels,
    material,
    canonical: { heightUnchanged: true, hydrologyUnchanged: true, coastlineUnchanged: true, colliderUnchanged: true, vegetationPlacementUnchanged: true, newGeographyIntroduced: false },
  });
}

export function blendGroundwaterFrames(a, b, mix = 0.5) {
  const t = clamp01(mix);
  const channels = {};
  for (const key of TERRAIN_GROUNDWATER_CHANNELS) channels[key] = lerp(a.channels[key], b.channels[key], t);
  const color = {};
  for (const key of ['r', 'g', 'b']) color[key] = lerp(a.material.color[key], b.material.color[key], t);
  return freeze({
    policyId: TERRAIN_GROUNDWATER_ADAPTER_POLICY.id,
    sourcePolicyId: TERRAIN_GROUNDWATER_POLICY.id,
    channels: freeze(channels),
    material: freeze({ color: freeze(color), roughness: lerp(a.material.roughness, b.material.roughness, t), normalStrength: lerp(a.material.normalStrength, b.material.normalStrength, t), wetness: lerp(a.material.wetness, b.material.wetness, t) }),
    canonical: freeze({ heightUnchanged: true, hydrologyUnchanged: true, coastlineUnchanged: true, colliderUnchanged: true, vegetationPlacementUnchanged: true, newGeographyIntroduced: false }),
  });
}

export function accumulateGroundwaterNeighborhood(samples = []) {
  if (!Array.isArray(samples) || samples.length === 0) return freeze({ count: 0, meanWetness: 0, meanSaturation: 0, meanSeepage: 0, meanCapillary: 0, meanPuddle: 0, edgeContrast: 0 });
  let wet = 0;
  let saturation = 0;
  let seepage = 0;
  let capillary = 0;
  let puddle = 0;
  let minWet = Infinity;
  let maxWet = -Infinity;
  for (const sample of samples) {
    const frame = sample.channels ? sample : resolveGroundwaterSurfaceFrame(sample);
    const w = frame.channels.wetness;
    wet += w; saturation += frame.channels.saturation; seepage += frame.channels.seepageFace; capillary += frame.channels.capillaryRise; puddle += frame.channels.puddlePersistence;
    minWet = Math.min(minWet, w); maxWet = Math.max(maxWet, w);
  }
  const count = samples.length;
  return freeze({ count, meanWetness: wet / count, meanSaturation: saturation / count, meanSeepage: seepage / count, meanCapillary: capillary / count, meanPuddle: puddle / count, edgeContrast: maxWet - minWet });
}

export function sharpenGroundwaterEdge(frame, neighborhood, strength = 0.35) {
  const t = clamp01(strength);
  const edge = clamp01(neighborhood.edgeContrast);
  const channels = { ...frame.channels };
  channels.wetness = clamp01(lerp(channels.wetness, channels.wetness * (1 + edge * 0.24), t));
  channels.surfaceFilm = clamp01(lerp(channels.surfaceFilm, channels.surfaceFilm * (1 + edge * 0.18), t));
  channels.saturation = clamp01(lerp(channels.saturation, channels.saturation * (1 + edge * 0.14), t));
  return freeze({ ...frame, channels: freeze(channels), edgeAccent: edge * t });
}

export function applyGroundwaterBudget(frame, { maxAlbedoShift = TERRAIN_GROUNDWATER_ADAPTER_POLICY.maxCombinedAlbedoShift, maxRoughnessShift = TERRAIN_GROUNDWATER_ADAPTER_POLICY.maxCombinedRoughnessShift, maxNormalStrength = TERRAIN_GROUNDWATER_ADAPTER_POLICY.maxCombinedNormalStrength } = {}) {
  const base = frame.material;
  return freeze({ ...frame, material: freeze({ ...base, color: freeze({ r: clamp01(base.color.r + clamp(base.color.r - 0.5, -maxAlbedoShift, maxAlbedoShift) * 0.16), g: clamp01(base.color.g + clamp(base.color.g - 0.5, -maxAlbedoShift, maxAlbedoShift) * 0.16), b: clamp01(base.color.b + clamp(base.color.b - 0.5, -maxAlbedoShift, maxAlbedoShift) * 0.16) }), roughness: clamp(base.roughness, 0.42, 1), normalStrength: clamp(base.normalStrength, 0, maxNormalStrength) }) });
}

export function classifyGroundwaterPresentation(frame) {
  const c = frame.channels;
  if (c.puddlePersistence > 0.72 && c.wetness > 0.68) return 'persistent-puddle';
  if (c.marshEdge > 0.7 && c.saturation > 0.68) return 'marsh-edge';
  if (c.seepageFace > 0.66) return 'seepage-face';
  if (c.saltRing > 0.62 && c.wetness < 0.36) return 'evaporative-ring';
  if (c.capillaryRise > 0.62 && c.dryingResistance > 0.58) return 'capillary-damp';
  if (c.wetness > 0.58) return 'damp-soil';
  if (c.dryingDemand > 0.72) return 'dry-recession';
  return 'neutral';
}

export function groundwaterDebugChannels(frame) {
  const c = frame.channels;
  return freeze([
    { id: 'wetness', value: c.wetness, label: 'surface wetness' },
    { id: 'table', value: c.waterTableProximity, label: 'water-table proximity' },
    { id: 'capillary', value: c.capillaryRise, label: 'capillary rise' },
    { id: 'seepage', value: c.seepageFace, label: 'seepage face' },
    { id: 'saturation', value: c.saturation, label: 'surface saturation' },
    { id: 'memory', value: c.memory, label: 'moisture memory' },
    { id: 'drying', value: c.dryingResistance, label: 'drying resistance' },
    { id: 'puddle', value: c.puddlePersistence, label: 'puddle persistence' },
    { id: 'marsh', value: c.marshEdge, label: 'marsh edge factor' },
    { id: 'fines', value: c.fineTransport, label: 'fine mineral transport' },
    { id: 'salt', value: c.saltRing, label: 'evaporative mineral ring' },
    { id: 'freeze', value: c.freezeWetness, label: 'wet freeze stress' },
    { id: 'dry-demand', value: c.dryingDemand, label: 'drying demand' },
  ]);
}

export function groundwaterSurfaceSignature(frame) {
  const c = frame.channels;
  return freeze({ wetness: Number(c.wetness.toFixed(5)), saturation: Number(c.saturation.toFixed(5)), seepage: Number(c.seepageFace.toFixed(5)), capillary: Number(c.capillaryRise.toFixed(5)), puddle: Number(c.puddlePersistence.toFixed(5)), marsh: Number(c.marshEdge.toFixed(5)), salt: Number(c.saltRing.toFixed(5)) });
}
