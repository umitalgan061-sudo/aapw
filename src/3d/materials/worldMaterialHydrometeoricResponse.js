/**
 * Hydrometeoric and solar-exposure response for existing world materials.
 *
 * This module is intentionally a response layer, not a weather simulation or a second geography
 * authority. Callers provide already-known canonical/environment observations such as wet edge,
 * precipitation, wind exposure, snow persistence and sun phase. The module turns those observations
 * into deterministic material hints consumed by the existing world-material fabric.
 *
 * No terrain, water, road, settlement, collider, vegetation placement or celestial geometry is
 * created or modified here.
 * @module materials/worldMaterialHydrometeoricResponse
 */

import { hashString } from './textureCore.js';

export const WORLD_HYDROMETEORIC_SURFACE_POLICY = Object.freeze({
  id: 'world-hydrometeoric-surface-response-2026-09-14-v1',
  revision: 'v1-weather-solar-freeze-thaw',
  renderOnly: true,
  deterministic: true,
  geometryUnchanged: true,
  canonicalTerrainUnchanged: true,
  canonicalHydrologyUnchanged: true,
  canonicalColliderUnchanged: true,
  canonicalVegetationPlacementUnchanged: true,
  precipitationAware: true,
  windExposureAware: true,
  solarExposureAware: true,
  freezeThawAware: true,
  evaporationAware: true,
  snowCrustAware: true,
  runoffAware: true,
  poolingAware: true,
  profileSpecific: true,
  phaseIndependentDefault: true,
  profiles: Object.freeze(['stone', 'wood', 'plaster', 'metal', 'cloth', 'vegetation', 'soil', 'snow', 'generic']),
});

const clamp01 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
};

const clamp = (value, lo, hi, fallback = lo) => {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : fallback;
};

const lerp = (a, b, t) => a + (b - a) * t;

const smoothstep = (a, b, x) => {
  if (a === b) return x >= b ? 1 : 0;
  const t = clamp01((Number(x) - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function finite(value, fallback = 0) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function stableSeed(value, salt = '') {
  return hashString(`${String(value ?? 'surface')}|${salt}`) >>> 0;
}

function hash01(value) {
  let x = Number(value) >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

function sampleWave(seed, phase) {
  const shifted = hash01(seed ^ Math.floor(phase * 4096));
  return 0.5 + 0.5 * Math.sin(phase * Math.PI * 2 + shifted * Math.PI * 2);
}

const WEATHER_PROFILE_LIBRARY = Object.freeze({
  stone: Object.freeze({
    wetGain: 0.94,
    poolingGain: 0.82,
    evaporationGain: 0.46,
    freezeGain: 0.90,
    thawGain: 0.76,
    crustGain: 0.64,
    windGain: 0.48,
    solarGain: 0.30,
    erosionGain: 0.52,
    darkenWet: 0.12,
    brightDry: 0.030,
  }),
  wood: Object.freeze({
    wetGain: 1.0,
    poolingGain: 0.64,
    evaporationGain: 0.36,
    freezeGain: 0.70,
    thawGain: 0.80,
    crustGain: 0.28,
    windGain: 0.56,
    solarGain: 0.39,
    erosionGain: 0.38,
    darkenWet: 0.16,
    brightDry: 0.024,
  }),
  plaster: Object.freeze({
    wetGain: 1.0,
    poolingGain: 0.58,
    evaporationGain: 0.34,
    freezeGain: 0.82,
    thawGain: 0.76,
    crustGain: 0.32,
    windGain: 0.42,
    solarGain: 0.35,
    erosionGain: 0.62,
    darkenWet: 0.17,
    brightDry: 0.018,
  }),
  metal: Object.freeze({
    wetGain: 0.76,
    poolingGain: 0.38,
    evaporationGain: 0.42,
    freezeGain: 0.46,
    thawGain: 0.68,
    crustGain: 0.20,
    windGain: 0.60,
    solarGain: 0.44,
    erosionGain: 0.30,
    darkenWet: 0.07,
    brightDry: 0.022,
  }),
  cloth: Object.freeze({
    wetGain: 0.88,
    poolingGain: 0.34,
    evaporationGain: 0.62,
    freezeGain: 0.60,
    thawGain: 0.86,
    crustGain: 0.14,
    windGain: 0.70,
    solarGain: 0.52,
    erosionGain: 0.22,
    darkenWet: 0.14,
    brightDry: 0.020,
  }),
  vegetation: Object.freeze({
    wetGain: 0.74,
    poolingGain: 0.46,
    evaporationGain: 0.72,
    freezeGain: 0.78,
    thawGain: 0.80,
    crustGain: 0.18,
    windGain: 0.76,
    solarGain: 0.58,
    erosionGain: 0.18,
    darkenWet: 0.09,
    brightDry: 0.030,
  }),
  soil: Object.freeze({
    wetGain: 1.0,
    poolingGain: 0.92,
    evaporationGain: 0.40,
    freezeGain: 0.86,
    thawGain: 0.94,
    crustGain: 0.42,
    windGain: 0.62,
    solarGain: 0.46,
    erosionGain: 0.78,
    darkenWet: 0.19,
    brightDry: 0.034,
  }),
  snow: Object.freeze({
    wetGain: 0.54,
    poolingGain: 0.38,
    evaporationGain: 0.24,
    freezeGain: 1.0,
    thawGain: 0.96,
    crustGain: 0.94,
    windGain: 0.88,
    solarGain: 0.70,
    erosionGain: 0.34,
    darkenWet: 0.04,
    brightDry: 0.012,
  }),
  generic: Object.freeze({
    wetGain: 0.80,
    poolingGain: 0.58,
    evaporationGain: 0.48,
    freezeGain: 0.62,
    thawGain: 0.70,
    crustGain: 0.34,
    windGain: 0.56,
    solarGain: 0.40,
    erosionGain: 0.38,
    darkenWet: 0.09,
    brightDry: 0.022,
  }),
});

const DEFAULT_WEATHER_STATE = Object.freeze({
  precipitation: 0,
  rain: 0,
  sleet: 0,
  snow: 0,
  wind: 0.45,
  solar: 0.50,
  temperature: 0.50,
  temperatureRange: 0.20,
  humidity: 0.50,
  wetness: 0,
  runoff: 0,
  pooling: 0,
  freezePotential: 0,
  thawPotential: 0,
  snowPersistence: 0,
  snowCrust: 0,
  exposure: 0.50,
  shelter: 0.50,
  slope: 0.25,
  age: 0.45,
  salt: 0,
  sediment: 0,
});

function normalizeProfile(profileId) {
  const id = String(profileId ?? 'generic').trim().toLowerCase();
  return WEATHER_PROFILE_LIBRARY[id] ? id : 'generic';
}

export function sanitizeHydrometeoricState(state = {}) {
  return Object.freeze({
    precipitation: clamp01(state.precipitation, DEFAULT_WEATHER_STATE.precipitation),
    rain: clamp01(state.rain, DEFAULT_WEATHER_STATE.rain),
    sleet: clamp01(state.sleet, DEFAULT_WEATHER_STATE.sleet),
    snow: clamp01(state.snow, DEFAULT_WEATHER_STATE.snow),
    wind: clamp01(state.wind, DEFAULT_WEATHER_STATE.wind),
    solar: clamp01(state.solar, DEFAULT_WEATHER_STATE.solar),
    temperature: clamp01(state.temperature, DEFAULT_WEATHER_STATE.temperature),
    temperatureRange: clamp01(state.temperatureRange, DEFAULT_WEATHER_STATE.temperatureRange),
    humidity: clamp01(state.humidity, DEFAULT_WEATHER_STATE.humidity),
    wetness: clamp01(state.wetness, DEFAULT_WEATHER_STATE.wetness),
    runoff: clamp01(state.runoff, DEFAULT_WEATHER_STATE.runoff),
    pooling: clamp01(state.pooling, DEFAULT_WEATHER_STATE.pooling),
    freezePotential: clamp01(state.freezePotential, DEFAULT_WEATHER_STATE.freezePotential),
    thawPotential: clamp01(state.thawPotential, DEFAULT_WEATHER_STATE.thawPotential),
    snowPersistence: clamp01(state.snowPersistence, DEFAULT_WEATHER_STATE.snowPersistence),
    snowCrust: clamp01(state.snowCrust, DEFAULT_WEATHER_STATE.snowCrust),
    exposure: clamp01(state.exposure, DEFAULT_WEATHER_STATE.exposure),
    shelter: clamp01(state.shelter, DEFAULT_WEATHER_STATE.shelter),
    slope: clamp01(state.slope, DEFAULT_WEATHER_STATE.slope),
    age: clamp01(state.age, DEFAULT_WEATHER_STATE.age),
    salt: clamp01(state.salt, DEFAULT_WEATHER_STATE.salt),
    sediment: clamp01(state.sediment, DEFAULT_WEATHER_STATE.sediment),
    waterProximity: clamp01(state.waterProximity, 0),
    waterDepth: clamp01(state.waterDepth, 0),
    riverProximity: clamp01(state.riverProximity, 0),
    wetEdge: clamp01(state.wetEdge, 0),
    spray: clamp01(state.spray, 0),
    coldWater: clamp01(state.coldWater, 0),
    canonicalObservation: Boolean(state.canonicalObservation),
  });
}

export function resolveFreezeThawState(state = {}) {
  const s = sanitizeHydrometeoricState(state);
  const cold = smoothstep(0.54, 0.92, 1 - s.temperature);
  const warm = smoothstep(0.46, 0.86, s.temperature);
  const wet = Math.max(s.wetness, s.precipitation * 0.72, s.wetEdge * 0.84);
  const freeze = clamp01(Math.max(s.freezePotential, cold * wet * (0.58 + s.humidity * 0.42)));
  const thaw = clamp01(Math.max(s.thawPotential, warm * s.solar * (0.44 + s.temperatureRange * 0.56)));
  const transition = clamp01(freeze * thaw * (1 - Math.abs(freeze - thaw)) * 2.0);
  return Object.freeze({
    freezePotential: freeze,
    thawPotential: thaw,
    freezeThawTransition: transition,
    overnightCrust: clamp01(freeze * (1 - s.solar) * 0.84),
    thawFilm: clamp01(thaw * wet * 0.74),
  });
}

export function resolveSolarDryingState(state = {}) {
  const s = sanitizeHydrometeoricState(state);
  const moisture = Math.max(s.wetness, s.rain * 0.78, s.wetEdge * 0.84, s.humidity * 0.22);
  const sheltered = s.shelter * 0.72 + (1 - s.exposure) * 0.28;
  const dryPotential = clamp01(
    s.solar * (1 - s.humidity * 0.52)
      * (0.58 + s.wind * 0.42)
      * (0.54 + s.exposure * 0.46)
      * (1 - sheltered * 0.34),
  );
  const evaporativeLoss = clamp01(dryPotential * moisture * 0.94);
  const residualMoisture = clamp01(moisture - evaporativeLoss * 0.64);
  return Object.freeze({ moisture, dryPotential, evaporativeLoss, residualMoisture, sheltered, solarBleach: clamp01(s.solar * (1 - s.humidity) * 0.52) });
}

export function resolveRunoffPoolingState(state = {}) {
  const s = sanitizeHydrometeoricState(state);
  const slopeRunoff = smoothstep(0.08, 0.62, s.slope);
  const flatPool = smoothstep(0.58, 0.96, 1 - s.slope);
  const rainPulse = Math.max(s.rain, s.precipitation * 0.72);
  const waterSupport = Math.max(s.waterProximity, s.wetEdge, s.riverProximity * 0.72);
  const runoff = clamp01(Math.max(s.runoff, rainPulse * (0.42 + slopeRunoff * 0.58), waterSupport * 0.46));
  const pooling = clamp01(Math.max(s.pooling, rainPulse * flatPool * (0.54 + s.humidity * 0.46), s.waterDepth * 0.76));
  const capillary = clamp01((1 - s.slope) * s.humidity * 0.52 + s.sediment * 0.17);
  return Object.freeze({ runoff, pooling, capillary, poolingBias: flatPool, runoffBias: slopeRunoff });
}

export function resolveWindAblationState(state = {}) {
  const s = sanitizeHydrometeoricState(state);
  const exposure = clamp01(s.exposure * 0.72 + s.wind * 0.28);
  const shelter = clamp01(s.shelter * 0.70 + (1 - exposure) * 0.30);
  const windAbrasion = clamp01(exposure * s.wind * (0.56 + s.age * 0.44));
  const particleTransport = clamp01(windAbrasion * (0.35 + s.sediment * 0.65));
  const snowDrift = clamp01(s.snow * s.wind * (0.48 + (1 - shelter) * 0.52));
  const dustFilm = clamp01((1 - s.humidity) * s.wind * (0.34 + s.sediment * 0.66));
  return Object.freeze({ exposure, shelter, windAbrasion, particleTransport, snowDrift, dustFilm });
}

export function resolveWeatherPhase(phase = 0, state = {}) {
  const s = sanitizeHydrometeoricState(state);
  const normalizedPhase = ((finite(phase, 0) % 1) + 1) % 1;
  const daylight = Math.max(0, Math.sin(normalizedPhase * Math.PI * 2));
  const dawn = 1 - Math.min(1, Math.abs(normalizedPhase - 0.25) / 0.18);
  const dusk = 1 - Math.min(1, Math.abs(normalizedPhase - 0.75) / 0.18);
  const nocturnal = 1 - daylight;
  const rainPulse = 0.72 + 0.28 * sampleWave(stableSeed(`${normalizedPhase}|rain`, 'weather-cycle'), normalizedPhase);
  const frostPulse = nocturnal * (1 - s.temperature) * (0.54 + s.humidity * 0.46);
  const dryingPulse = daylight * s.solar * (1 - s.humidity) * (0.60 + s.wind * 0.40);
  return Object.freeze({
    phase: normalizedPhase,
    daylight,
    dawn,
    dusk,
    nocturnal,
    rainPulse,
    frostPulse: clamp01(frostPulse),
    dryingPulse: clamp01(dryingPulse),
    precipitationPulse: clamp01(s.precipitation * rainPulse),
  });
}

function combineWeatherStates(s, freeze, drying, runoff, wind) {
  const wet = clamp01(Math.max(s.wetness, s.precipitation * 0.58, runoff.runoff * 0.46, s.wetEdge * 0.72));
  const retainedWet = clamp01(wet * (0.58 + s.humidity * 0.42) + drying.residualMoisture * 0.20 - drying.evaporativeLoss * 0.14);
  const frostSurface = clamp01(Math.max(freeze.freezePotential, s.snowPersistence * 0.72, s.snow * 0.48));
  const exposedDryness = clamp01(drying.dryPotential * 0.54 + wind.windAbrasion * 0.26 + (1 - s.humidity) * 0.20);
  const snowCrust = clamp01(Math.max(s.snowCrust, frostSurface * 0.62 + freeze.overnightCrust * 0.38));
  const meltFilm = clamp01(freeze.thawFilm + drying.residualMoisture * 0.24);
  return Object.freeze({ wet, retainedWet, frostSurface, exposedDryness, snowCrust, meltFilm });
}

function materialFinish(profileId, s, weather, freeze, drying, runoff, wind) {
  const P = WEATHER_PROFILE_LIBRARY[normalizeProfile(profileId)];
  const wet = weather.retainedWet * P.wetGain;
  const pool = runoff.pooling * P.poolingGain;
  const freeze = freeze.freezePotential * P.freezeGain;
  const thaw = freeze.thawPotential * P.thawGain;
  const abrasion = wind.windAbrasion * P.windGain;
  const solar = drying.solarBleach * P.solarGain;
  const wetDark = wet * P.darkenWet;
  const dryBright = solar * P.brightDry;
  const roughness = clamp(
    0.42
      + wet * 0.18
      + pool * 0.12
      + freeze * 0.11
      + abrasion * 0.10
      + (1 - s.humidity) * 0.035
      - thaw * 0.03,
    0.10,
    1.0,
    0.72,
  );
  const normal = clamp(
    0.02
      + wet * 0.032
      + pool * 0.018
      + freeze * 0.038
      + abrasion * P.erosionGain * 0.032
      + s.sediment * 0.016,
    0.010,
    0.26,
    0.05,
  );
  const albedo = clamp(
    -wetDark
      + dryBright
      + s.sediment * (profileId === 'soil' ? 0.028 : 0.012)
      - freeze * 0.018
      + wind.dustFilm * 0.020,
    -0.28,
    0.28,
    0,
  );
  const streak = clamp01(runoff.runoff * 0.54 + s.spray * 0.24 + wind.particleTransport * 0.22);
  const crust = clamp01(weather.snowCrust * P.crustGain + freeze * 0.11);
  const frost = clamp01(freeze * 0.82 + weather.frostSurface * 0.18);
  const dust = clamp01(wind.dustFilm * 0.62 + (1 - s.humidity) * 0.20 + s.exposure * 0.18);
  return Object.freeze({
    wet,
    pooling: pool,
    freeze,
    thaw,
    abrasion,
    solar,
    albedo,
    roughness,
    normal,
    streak,
    crust,
    frost,
    dust,
    residualMoisture: drying.residualMoisture,
    meltFilm: weather.meltFilm,
  });
}

export function resolveHydrometeoricSurfaceResponse({ profileId = 'generic', state = {}, phase = null, seed = 0 } = {}) {
  const s = sanitizeHydrometeoricState(state);
  const freeze = resolveFreezeThawState(s);
  const drying = resolveSolarDryingState(s);
  const runoff = resolveRunoffPoolingState(s);
  const wind = resolveWindAblationState(s);
  const weather = combineWeatherStates(s, freeze, drying, runoff, wind);
  const finish = materialFinish(profileId, s, weather, freeze, drying, runoff, wind);
  const phaseResponse = phase === null ? null : resolveWeatherPhase(phase, s);
  const stable = stableSeed(seed || `${profileId}|${s.slope}|${s.exposure}`, 'hydrometeoric');
  return Object.freeze({
    policyId: WORLD_HYDROMETEORIC_SURFACE_POLICY.id,
    profileId: normalizeProfile(profileId),
    seed: stable,
    state: s,
    freeze,
    drying,
    runoff,
    wind,
    weather,
    finish,
    phase: phaseResponse,
    diagnostics: Object.freeze({
      finite: [
        ...Object.values(finish),
        freeze.freezePotential,
        freeze.thawPotential,
        drying.evaporativeLoss,
        runoff.pooling,
        runoff.runoff,
        wind.windAbrasion,
      ].every(Number.isFinite),
      geometryMutation: false,
      geographyMutation: false,
    }),
  });
}

function mergeFabric(existing, finish, state) {
  const source = existing && typeof existing === 'object' ? existing : {};
  return Object.freeze({
    ...source,
    hydrometeoricWetness: Math.max(clamp01(source.hydrometeoricWetness, 0), finish.wet),
    hydrometeoricFreeze: Math.max(clamp01(source.hydrometeoricFreeze, 0), finish.freeze),
    hydrometeoricThaw: Math.max(clamp01(source.hydrometeoricThaw, 0), finish.thaw),
    hydrometeoricAbrasion: Math.max(clamp01(source.hydrometeoricAbrasion, 0), finish.abrasion),
    hydrometeoricDust: Math.max(clamp01(source.hydrometeoricDust, 0), finish.dust),
    hydrometeoricCrust: Math.max(clamp01(source.hydrometeoricCrust, 0), finish.crust),
    hydrometeoricStreak: Math.max(clamp01(source.hydrometeoricStreak, 0), finish.streak),
    poolingResponse: Math.max(clamp01(source.poolingResponse, 0), finish.pooling),
    meltFilmResponse: Math.max(clamp01(source.meltFilmResponse, 0), finish.meltFilm),
    solarExposure: Math.max(clamp01(source.solarExposure, 0), state.solar),
    windExposure: Math.max(clamp01(source.windExposure, 0), state.wind),
  });
}

function mergeEnvironment(existing, finish, state) {
  const source = existing && typeof existing === 'object' ? existing : {};
  return Object.freeze({
    ...source,
    freeze: Math.max(clamp01(source.freeze, 0), finish.freeze),
    thaw: Math.max(clamp01(source.thaw, 0), finish.thaw),
    dust: Math.max(clamp01(source.dust, 0), finish.dust),
    wetEdge: Math.max(clamp01(source.wetEdge, 0), finish.wet),
    runoff: Math.max(clamp01(source.runoff, 0), state.runoff),
    pooling: Math.max(clamp01(source.pooling, 0), finish.pooling),
    solarExposure: Math.max(clamp01(source.solarExposure, 0), state.solar),
    windExposure: Math.max(clamp01(source.windExposure, 0), state.wind),
    residualMoisture: Math.max(clamp01(source.residualMoisture, 0), finish.residualMoisture),
  });
}

export function enrichMaterialWithHydrometeoricReality(materialResponse = {}, context = {}) {
  const profileId = normalizeProfile(context.profileId || materialResponse.profileId || 'generic');
  const state = sanitizeHydrometeoricState({
    ...(context.state || {}),
    wetness: context.state?.wetness ?? materialResponse?.context?.wetEdge ?? context.wetEdge ?? materialResponse?.fabric?.hydrologyWetness,
    wetEdge: context.wetEdge ?? materialResponse?.context?.wetEdge,
    waterProximity: context.waterProximity ?? materialResponse?.context?.waterProximity,
    riverProximity: context.riverProximity ?? materialResponse?.context?.riverProximity,
    spray: context.spray ?? materialResponse?.environment?.spray,
    salt: context.salt ?? materialResponse?.environment?.salt,
    sediment: context.sediment ?? materialResponse?.environment?.sediment,
    frost: context.frost ?? materialResponse?.environment?.frost,
    snowPersistence: context.snowPersistence ?? materialResponse?.context?.snow,
    exposure: context.exposure ?? materialResponse?.context?.exposure,
    shelter: context.shelter ?? materialResponse?.context?.shelter,
    slope: context.slope ?? materialResponse?.context?.slope,
  });
  const response = resolveHydrometeoricSurfaceResponse({
    profileId,
    state,
    phase: context.phase ?? null,
    seed: context.seed ?? materialResponse.seed ?? 0,
  });
  return Object.freeze({
    ...materialResponse,
    hydrometeoricPolicyId: WORLD_HYDROMETEORIC_SURFACE_POLICY.id,
    hydrometeoric: response,
    fabric: mergeFabric(materialResponse.fabric, response.finish, state),
    environment: mergeEnvironment(materialResponse.environment, response.finish, state),
  });
}

export function applyHydrometeoricResponseToObject(object, options = {}) {
  if (!object || typeof object !== 'object') return { ok: false, error: 'missing-object' };
  const current = object.userData?.worldAssetSurfaceResponse || {};
  const response = enrichMaterialWithHydrometeoricReality(current, options);
  object.userData ||= {};
  object.userData.worldAssetSurfaceResponse = response;
  object.userData.worldHydrometeoricReality = response.hydrometeoric;
  return Object.freeze({ ok: true, changed: true, response });
}

export function hydrometeoricSurfaceFingerprint(response) {
  const finish = response?.finish || response?.hydrometeoric?.finish || {};
  const values = [
    response?.policyId || response?.hydrometeoricPolicyId,
    response?.profileId,
    finish.wet,
    finish.pooling,
    finish.freeze,
    finish.thaw,
    finish.abrasion,
    finish.albedo,
    finish.roughness,
    finish.normal,
    finish.streak,
    finish.crust,
    finish.dust,
  ];
  return values.map((value) => typeof value === 'number' ? value.toFixed(8) : String(value)).join('|');
}

export function validateHydrometeoricSurfaceResponse(response) {
  const errors = [];
  const finish = response?.finish || response?.hydrometeoric?.finish;
  if (!finish) errors.push('missing-finish');
  const values = finish ? Object.values(finish) : [];
  if (values.some((value) => !Number.isFinite(value))) errors.push('non-finite-finish');
  if (finish && (finish.roughness < 0.10 || finish.roughness > 1.0)) errors.push('roughness-out-of-bounds');
  if (finish && (finish.normal < 0.010 || finish.normal > 0.26)) errors.push('normal-out-of-bounds');
  if (finish && (finish.albedo < -0.28 || finish.albedo > 0.28)) errors.push('albedo-out-of-bounds');
  return Object.freeze({ ok: errors.length === 0, errors, policyId: WORLD_HYDROMETEORIC_SURFACE_POLICY.id });
}

export function createHydrometeoricMatrix(samples = []) {
  if (!Array.isArray(samples)) throw new TypeError('samples must be an array');
  return Object.freeze(samples.map((sample, index) => {
    const response = resolveHydrometeoricSurfaceResponse({
      profileId: sample.profileId,
      state: sample.state,
      phase: sample.phase,
      seed: sample.seed ?? index * 104729,
    });
    return Object.freeze({
      index,
      profileId: response.profileId,
      fingerprint: hydrometeoricSurfaceFingerprint(response),
      response,
    });
  }));
}

export function assertHydrometeoricSurfaceContract() {
  const probes = [
    { profileId: 'stone', state: { wetEdge: 0.82, precipitation: 0.72, runoff: 0.60, slope: 0.18, humidity: 0.84 } },
    { profileId: 'wood', state: { rain: 0.90, humidity: 0.88, wind: 0.58, solar: 0.30, exposure: 0.42 } },
    { profileId: 'metal', state: { salt: 0.82, wetEdge: 0.66, wind: 0.72, solar: 0.64 } },
    { profileId: 'snow', state: { snow: 0.96, snowPersistence: 0.94, wind: 0.78, temperature: 0.08, humidity: 0.84, solar: 0.28 } },
    { profileId: 'soil', state: { rain: 0.88, pooling: 0.82, slope: 0.05, sediment: 0.74, solar: 0.20 } },
    { profileId: 'vegetation', state: { snow: 0.22, wind: 0.76, solar: 0.72, humidity: 0.44, exposure: 0.79 } },
  ];
  const first = probes.map((probe) => resolveHydrometeoricSurfaceResponse(probe));
  const second = probes.map((probe) => resolveHydrometeoricSurfaceResponse(probe));
  for (let i = 0; i < first.length; i += 1) {
    const validation = validateHydrometeoricSurfaceResponse(first[i]);
    if (!validation.ok) throw new Error(`hydrometeoric validation failed at probe ${i}`);
    if (hydrometeoricSurfaceFingerprint(first[i]) !== hydrometeoricSurfaceFingerprint(second[i])) {
      throw new Error(`hydrometeoric determinism failed at probe ${i}`);
    }
  }
  const cold = first.find((item) => item.profileId === 'snow');
  const soil = first.find((item) => item.profileId === 'soil');
  if (!(cold.finish.crust > soil.finish.crust)) throw new Error('snow crust response did not dominate soil');
  if (!(soil.finish.pooling > cold.finish.pooling)) throw new Error('soil pooling response did not dominate snow');
  return Object.freeze({
    ok: true,
    policyId: WORLD_HYDROMETEORIC_SURFACE_POLICY.id,
    probeCount: probes.length,
    fingerprints: first.map(hydrometeoricSurfaceFingerprint),
  });
}

export const __HYDROMETEORIC_SURFACE_PROFILE_COUNT = Object.freeze(Object.keys(WEATHER_PROFILE_LIBRARY).length);

export default Object.freeze({
  WORLD_HYDROMETEORIC_SURFACE_POLICY,
  sanitizeHydrometeoricState,
  resolveFreezeThawState,
  resolveSolarDryingState,
  resolveRunoffPoolingState,
  resolveWindAblationState,
  resolveWeatherPhase,
  resolveHydrometeoricSurfaceResponse,
  enrichMaterialWithHydrometeoricReality,
  applyHydrometeoricResponseToObject,
  hydrometeoricSurfaceFingerprint,
  validateHydrometeoricSurfaceResponse,
  createHydrometeoricMatrix,
  assertHydrometeoricSurfaceContract,
  __HYDROMETEORIC_SURFACE_PROFILE_COUNT,
});
