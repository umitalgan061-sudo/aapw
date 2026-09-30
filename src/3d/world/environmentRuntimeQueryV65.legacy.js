import { buildAdaptiveDecision, normalizeObservation } from './environmentRuntimeAdaptiveV65.js';
import { groundReaction } from './environmentRuntimeSurfaceV65.js';
import { buildChunkContinuity, chunkKey } from './environmentRuntimeContinuityV65.js';
import { buildFrameEnvelope } from './environmentRuntimeStreamingV65.js';
import { surfaceSeasonalResponse } from './environmentRuntimePhenologyV65.js';

export const V65_QUERY_POLICY = Object.freeze({
  id: 'environment-runtime-query-v65-2026-09-14',
  version: 65,
  deterministic: true,
  sources: Object.freeze(['terrain', 'hydrology', 'biome', 'roads', 'settlements', 'weather']),
  noMutation: true,
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, Number.isFinite(v) ? v : min));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;

export const normalizeWorldSample = (sample = {}) => {
  const value = normalizeObservation(sample);
  return {
    ...value,
    water: sample.water === true,
    road: sample.road === true,
    settlement: sample.settlement === true,
    permanentSnow: sample.permanentSnow === true,
    navigable: sample.navigable !== false,
    normal: sample.normal || { x: 0, y: 1, z: 0 },
    distance: Math.max(0, finite(sample.distance, 0)),
  };
};

export const groundState = (sample) => {
  const s = normalizeWorldSample(sample);
  const grounded = s.confidence >= 0.55 && s.slope <= 48 && !s.water && !s.permanentSnow;
  return {
    grounded,
    confidence: s.confidence,
    slope: s.slope,
    elevation: s.elevation,
    safeForPlayer: grounded && !s.settlement && s.roadDistance > 3,
    safeForTree: grounded && s.settlementDistance > 14 && s.roadDistance > 7,
  };
};

export const waterState = (sample) => {
  const s = normalizeWorldSample(sample);
  const shoreline = s.waterDistance < 140;
  return {
    water: s.water,
    shoreline,
    depthBand: s.water ? (s.elevation < -3 ? 'deep' : s.elevation < 1 ? 'shallow' : 'edge') : 'land',
    wetEdge: clamp(1 - s.waterDistance / 150, 0, 1),
    navigable: s.water && s.slope < 8,
  };
};

export const biomeState = (sample) => {
  const s = normalizeWorldSample(sample);
  const adaptation = buildAdaptiveDecision(s);
  return {
    primary: adaptation.primaryFamily,
    fallback: adaptation.fallbackFamily,
    biome: s.biome,
    candidates: adaptation.families,
    density: adaptation.density,
  };
};

export const weatherState = (sample, weather = {}) => groundReaction(normalizeWorldSample(sample), weather, weather.snowline ?? 720);

export const phenologyState = (sample, dayOfYear = 180) => surfaceSeasonalResponse({ ...normalizeWorldSample(sample), dayOfYear });

export const placementState = (sample, family = null) => {
  const s = normalizeWorldSample(sample);
  const decision = buildAdaptiveDecision(s);
  const selected = family || decision.primaryFamily;
  const candidate = decision.families.find((entry) => entry.family === selected);
  return {
    family: selected,
    eligible: Boolean(candidate?.mask?.eligible),
    score: candidate?.runtimeScore ?? 0,
    confidence: s.confidence,
    exclusion: s.water ? 'water' : s.slope > 48 ? 'steep' : s.roadDistance < 7 ? 'road-buffer' : s.settlementDistance < 12 ? 'settlement-buffer' : null,
  };
};

export const navigationState = (sample) => {
  const s = normalizeWorldSample(sample);
  return {
    navigable: s.navigable && !s.water && s.slope < 36,
    traversalClass: s.slope < 8 ? 'easy' : s.slope < 20 ? 'moderate' : s.slope < 36 ? 'hard' : 'cliff',
    slope: s.slope,
    road: s.road,
    settlement: s.settlement,
  };
};

export const environmentSnapshot = ({ sample = {}, weather = {}, dayOfYear = 180, streaming = {}, chunks = {} } = {}) => {
  const s = normalizeWorldSample(sample);
  const key = chunkKey(s.x, s.z);
  const continuity = buildChunkContinuity({ key, anchors: chunks[key] || [], neighbors: Object.fromEntries(Object.entries(chunks).filter(([k]) => k !== key)) });
  const frame = buildFrameEnvelope(streaming);
  return {
    policy: V65_QUERY_POLICY.id,
    sample: s,
    ground: groundState(s),
    water: waterState(s),
    biome: biomeState(s),
    weather: weatherState(s, weather),
    phenology: phenologyState(s, dayOfYear),
    placement: placementState(s),
    navigation: navigationState(s),
    continuity: continuity.summary,
    streaming: frame,
  };
};

export const querySafety = (snapshot) => {
  const errors = [];
  if (snapshot?.policy !== V65_QUERY_POLICY.id) errors.push('policy');
  if (snapshot?.ground?.safeForTree && snapshot?.water?.water) errors.push('tree-water-conflict');
  if (snapshot?.placement?.eligible && snapshot?.ground?.grounded !== true) errors.push('ungrounded-placement');
  if (snapshot?.streaming?.overBudget) errors.push('streaming-over-budget');
  return { ok: errors.length === 0, errors };
};

export const immutableDigest = (snapshot) => {
  let h = 2166136261;
  for (const c of JSON.stringify(snapshot)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(16).padStart(8, '0');
};

export const buildReadOnlyBatch = (samples = [], options = {}) => {
  const snapshots = samples.map((sample) => environmentSnapshot({ sample, ...options }));
  return {
    snapshots,
    safe: snapshots.every((snapshot) => querySafety(snapshot).ok),
    digest: immutableDigest(snapshots),
  };
};

export const validateSnapshot = (snapshot) => {
  const errors = [];
  if (!snapshot) errors.push('missing');
  if (snapshot?.policy !== V65_QUERY_POLICY.id) errors.push('policy');
  for (const key of ['ground', 'water', 'biome', 'weather', 'phenology', 'placement', 'navigation']) if (!snapshot?.[key]) errors.push(`missing:${key}`);
  return { ok: errors.length === 0, errors };
};

export const querySummary = (batch) => ({
  policy: V65_QUERY_POLICY.id,
  count: batch?.snapshots?.length || 0,
  safe: batch?.safe === true,
  digest: batch?.digest || null,
});
