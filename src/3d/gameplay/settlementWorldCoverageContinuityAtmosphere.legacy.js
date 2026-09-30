/**
 * Read-only environmental presentation layer for World Coverage continuity.
 *
 * Time, weather and visibility inputs are sampled from authoritative callers.
 * This module never creates weather, terrain, lights, particles or audio nodes.
 */
import { continuitySeedFor, deterministicJitter } from '../world/geographicAssetRuntimeOrchestrator.js';
import { SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY } from './settlementWorldCoverageContinuity.js';

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ATMOSPHERE_VERSION = 1;
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES = Object.freeze([
  'pre-dawn', 'dawn', 'morning', 'midday', 'afternoon', 'dusk', 'evening', 'night',
]);
export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_WEATHER = Object.freeze([
  'clear', 'cloud', 'fog', 'rain', 'snow', 'storm', 'wind', 'sleet',
]);

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
const clamp01 = (value, fallback = 0) => Math.max(0, Math.min(1, number(value, fallback)));
const text = (value, fallback = '') => {
  const normalized = String(value ?? '').trim();
  return normalized ? normalized.slice(0, 120) : fallback;
};
const freeze = (value, seen = new Set()) => {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value); Object.freeze(value);
  for (const child of Object.values(value)) freeze(child, seen);
  return value;
};
const stable = (value) => value === null || typeof value !== 'object'
  ? JSON.stringify(value)
  : Array.isArray(value)
    ? `[${value.map(stable).join(',')}]`
    : `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`;
const digest = (value) => {
  let hash = 2166136261; const source = stable(value);
  for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

function normalizeHour(value) {
  const hour = number(value, 12);
  const wrapped = ((hour % 24) + 24) % 24;
  return Math.round(wrapped * 100) / 100;
}
function phaseForHour(hour) {
  if (hour < 5) return 'pre-dawn';
  if (hour < 7) return 'dawn';
  if (hour < 11) return 'morning';
  if (hour < 15) return 'midday';
  if (hour < 18) return 'afternoon';
  if (hour < 20) return 'dusk';
  if (hour < 23) return 'evening';
  return 'night';
}
function phaseProgress(hour) {
  const starts = { 'pre-dawn':0, dawn:5, morning:7, midday:11, afternoon:15, dusk:18, evening:20, night:23 };
  const phase = phaseForHour(hour);
  const start = starts[phase];
  const next = phase === 'night' ? 24 : Object.values(starts)[Object.keys(starts).indexOf(phase) + 1];
  return clamp01((hour - start) / Math.max(.01, next - start));
}
function normalizeWeather(raw = {}) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const weather = text(source.type ?? source.state, 'clear').toLowerCase();
  return {
    type: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_WEATHER.includes(weather) ? weather : 'clear',
    intensity: clamp01(source.intensity, weather === 'clear' ? 0 : .5),
    visibility: clamp01(source.visibility, weather === 'fog' ? .48 : weather === 'storm' ? .42 : .9),
    precipitation: clamp01(source.precipitation, ['rain','snow','sleet'].includes(weather) ? .75 : 0),
    wind: clamp01(source.wind, ['wind','storm'].includes(weather) ? .8 : 0.18),
    wetness: clamp01(source.wetness, ['rain','storm'].includes(weather) ? .7 : 0.1),
    temperatureC: number(source.temperatureC, 8),
  };
}
function skyFactor(phase) {
  return {
    'pre-dawn': .2, dawn: .52, morning: .8, midday: 1,
    afternoon: .92, dusk: .5, evening: .28, night: .08,
  }[phase] ?? .5;
}
function weatherFactor(weather) {
  return {
    clear: 1, cloud: .9, fog: .62, rain: .72, snow: .66, storm: .42, wind: .82, sleet: .54,
  }[weather.type] ?? .7;
}
function contextBias(context = {}) {
  const layer = text(context.layer, '').toLowerCase();
  const biome = text(context.biome, '').toLowerCase();
  if (layer.includes('shore') || context.isWater) return .86;
  if (layer.includes('forest') || biome.includes('woodland')) return .93;
  if (biome.includes('mountain') || layer.includes('alpine')) return .8;
  if (biome.includes('moor')) return .88;
  return 1;
}

export function resolveSettlementWorldCoverageTimePhase(hour = 12) {
  const normalizedHour = normalizeHour(hour);
  const phase = phaseForHour(normalizedHour);
  return freeze({ hour: normalizedHour, phase, progress: phaseProgress(normalizedHour), skyFactor: skyFactor(phase) });
}

export function resolveSettlementWorldCoverageAtmosphere({
  settlementId = 'settlement',
  worldX = 0,
  worldZ = 0,
  seed = 0,
  hour = 12,
  weather = {},
  context = {},
  stage = 'far',
  mobile = false,
} = {}) {
  const time = resolveSettlementWorldCoverageTimePhase(hour);
  const normalizedWeather = normalizeWeather(weather);
  const geography = contextBias({ ...context, isWater: context.isWater });
  const seedValue = continuitySeedFor({ worldX, worldZ, seed, familyId: settlementId });
  const jitter = deterministicJitter(seedValue, Math.floor(time.hour * 4));
  const weatherVisibility = normalizedWeather.visibility * weatherFactor(normalizedWeather);
  const readability = clamp01(time.skyFactor * weatherVisibility * geography * (stage === 'far' ? .82 : stage === 'threshold' ? 1 : .94));
  const ambientDensity = clamp01((stage === 'far' ? .38 : stage === 'approach' ? .62 : stage === 'threshold' ? .84 : 1) * weatherFactor(normalizedWeather) * (mobile ? .62 : 1));
  const soundActivity = clamp01((stage === 'inside' || stage === 'service' ? .85 : .45) * (time.phase === 'night' ? .48 : 1) * (normalizedWeather.type === 'storm' ? .42 : 1));
  const landmarkContrast = clamp01(.55 + readability * .4 - normalizedWeather.intensity * .18);
  const precipitationVisibility = clamp01(normalizedWeather.precipitation * (1 - time.skyFactor * .25));
  const windCue = clamp01(normalizedWeather.wind * (.55 + jitter.scale * .35));
  const result = {
    version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ATMOSPHERE_VERSION,
    settlementId: text(settlementId, 'settlement'),
    time,
    weather: normalizedWeather,
    presentation: {
      readability: Math.round(readability * 1000) / 1000,
      ambientDensity: Math.round(ambientDensity * 1000) / 1000,
      soundActivity: Math.round(soundActivity * 1000) / 1000,
      landmarkContrast: Math.round(landmarkContrast * 1000) / 1000,
      precipitationVisibility: Math.round(precipitationVisibility * 1000) / 1000,
      windCue: Math.round(windCue * 1000) / 1000,
    },
    world: { x:number(worldX), z:number(worldZ), continuitySeed:seedValue },
    constraints: {
      policy: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_POLICY.id,
      readOnly: true,
      noWeatherMutation: true,
      noLightingMutation: true,
      noParticleCreation: true,
      mobile,
    },
  };
  return freeze({ ...result, fingerprint: digest(result) });
}

export function validateSettlementWorldCoverageAtmosphere(input = {}) {
  const result = resolveSettlementWorldCoverageAtmosphere(input);
  const errors = [];
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES.includes(result.time.phase)) errors.push('time-phase');
  if (!SETTLEMENT_WORLD_COVERAGE_CONTINUITY_WEATHER.includes(result.weather.type)) errors.push('weather-type');
  for (const [key, value] of Object.entries(result.presentation)) if (!Number.isFinite(value) || value < 0 || value > 1) errors.push(`presentation:${key}`);
  if (!result.constraints.readOnly || !result.constraints.noWeatherMutation) errors.push('ownership');
  return freeze({ ok: errors.length === 0, errors, fingerprint: result.fingerprint });
}

export const SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ATMOSPHERE_API = Object.freeze({
  version: SETTLEMENT_WORLD_COVERAGE_CONTINUITY_ATMOSPHERE_VERSION,
  timePhases: [...SETTLEMENT_WORLD_COVERAGE_CONTINUITY_TIME_PHASES],
  weather: [...SETTLEMENT_WORLD_COVERAGE_CONTINUITY_WEATHER],
});
