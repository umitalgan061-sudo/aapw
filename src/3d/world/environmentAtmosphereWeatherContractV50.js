/**
 * Deterministic, DOM-free atmosphere/weather contract for the shipped world.
 *
 * The caller owns renderer, sky, fog, weather particles, audio, time-of-day,
 * terrain, hydrology, colliders and scene mutation. This module only converts
 * caller-owned observations into bounded, serializable presentation intent.
 * It deliberately avoids creating geometry, inventing geography, loading
 * assets, importing editor code, or replacing the shared placement authority.
 */

const MAX_SAMPLES = 256;
const MAX_FOG_DENSITY = 0.18;
const MAX_WEATHER_INTENSITY = 1;
const MAX_AUDIO_ZONE_COUNT = 64;
const DEFAULT_SEED = 1701;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const positive = (value, fallback = 0) => Math.max(0, finite(value, fallback));

const round = (value, digits = 6) => {
  const scale = 10 ** digits;
  return Math.round(finite(value) * scale) / scale;
};

const hash32 = (value) => {
  let hash = 2166136261;
  const text = String(value);
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
};

const noise01 = (seed, value) => (hash32(`${seed}:${value}`) % 100000) / 100000;

const normalizeId = (value, fallback) => {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return normalized.replace(/[^a-z0-9._:-]+/g, '-').slice(0, 96) || fallback;
};

const normalizeVector = (value, fallback = { x: 0, y: 0, z: 0 }) => ({
  x: round(finite(value?.x, fallback.x)),
  y: round(finite(value?.y, fallback.y)),
  z: round(finite(value?.z, fallback.z)),
});

const deepFreeze = (value) => {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  Object.values(value).forEach(deepFreeze);
  return value;
};

const stableStringify = (value) => {
  const normalize = (input) => {
    if (Array.isArray(input)) return input.map(normalize);
    if (!input || typeof input !== 'object') return input;
    return Object.keys(input).sort().reduce((output, key) => {
      output[key] = normalize(input[key]);
      return output;
    }, {});
  };
  return JSON.stringify(normalize(value));
};

const normalizeWeatherClass = (value) => {
  const candidate = normalizeId(value, 'clear');
  return ['clear', 'cloudy', 'mist', 'rain', 'snow', 'storm', 'wind'].includes(candidate)
    ? candidate
    : 'clear';
};

const weatherFromObservation = (observation = {}) => {
  const cloud = clamp(finite(observation.cloud, 0), 0, 1);
  const precipitation = clamp(finite(observation.precipitation, 0), 0, 1);
  const wind = clamp(finite(observation.wind, 0), 0, 1);
  const temperature = clamp(finite(observation.temperatureC, 12), -40, 60);
  const snowLikelihood = clamp((0 - temperature) / 18, 0, 1) * precipitation;
  const rainLikelihood = clamp((temperature + 4) / 18, 0, 1) * precipitation;
  const classHint = normalizeWeatherClass(observation.weatherClass);
  const derivedClass = classHint !== 'clear'
    ? classHint
    : snowLikelihood > 0.45 ? 'snow'
      : rainLikelihood > 0.35 ? 'rain'
        : wind > 0.72 ? 'wind'
          : cloud > 0.65 ? 'cloudy'
            : cloud > 0.4 ? 'mist'
              : 'clear';
  return {
    class: derivedClass,
    cloud: round(cloud),
    precipitation: round(precipitation),
    wind: round(wind),
    temperatureC: round(temperature, 3),
    snowLikelihood: round(snowLikelihood),
    rainLikelihood: round(rainLikelihood),
  };
};

const normalizeSample = (sample = {}, index, seed) => {
  const id = normalizeId(sample.id, `sample-${index}`);
  const elevation = finite(sample.elevation, 0);
  const moisture = clamp(finite(sample.moisture, 0), 0, 1);
  const snow = clamp(finite(sample.snow, 0), 0, 1);
  const waterDistance = positive(sample.waterDistance, 999999);
  const biome = normalizeId(sample.biome, 'unknown');
  const weather = weatherFromObservation(sample.weather);
  const horizonOcclusion = clamp(finite(sample.horizonOcclusion, 0), 0, 1);
  const distance = positive(sample.distance, 0);
  const phase = round(noise01(seed, `${id}:phase`));
  const visibility = round(clamp(1 - (distance / 180000) - horizonOcclusion * 0.35, 0.08, 1));
  const precipitationVisibility = round(clamp(visibility * (0.45 + weather.precipitation * 0.55), 0, 1));
  return {
    id,
    position: normalizeVector(sample.position),
    elevation: round(elevation, 3),
    moisture: round(moisture),
    snow: round(snow),
    waterDistance: round(waterDistance, 3),
    biome,
    distance: round(distance, 3),
    horizonOcclusion: round(horizonOcclusion),
    weather,
    phase,
    visibility,
    precipitationVisibility,
  };
};

const buildFog = (samples) => {
  const averageDistance = samples.length
    ? samples.reduce((sum, sample) => sum + sample.distance, 0) / samples.length
    : 0;
  const averageMoisture = samples.length
    ? samples.reduce((sum, sample) => sum + sample.moisture, 0) / samples.length
    : 0;
  const averageOcclusion = samples.length
    ? samples.reduce((sum, sample) => sum + sample.horizonOcclusion, 0) / samples.length
    : 0;
  const density = clamp(0.002 + averageMoisture * 0.018 + averageOcclusion * 0.012 + averageDistance / 1000000, 0.001, MAX_FOG_DENSITY);
  const near = clamp(12 + averageOcclusion * 36, 8, 72);
  const far = clamp(180 + averageDistance * 1.25, 220, 180000);
  return {
    density: round(density),
    near: round(near, 3),
    far: round(Math.max(far, near + 1), 3),
    aerialPerspective: round(clamp(0.18 + averageDistance / 120000 + averageOcclusion * 0.25, 0.12, 0.92)),
  };
};

const buildSky = (samples) => {
  const averageCloud = samples.length
    ? samples.reduce((sum, sample) => sum + sample.weather.cloud, 0) / samples.length
    : 0;
  const averageSnow = samples.length
    ? samples.reduce((sum, sample) => sum + sample.snow, 0) / samples.length
    : 0;
  const luminanceFloor = round(clamp(0.14 + (1 - averageCloud) * 0.22 + averageSnow * 0.05, 0.12, 0.48));
  return {
    cameraRelative: true,
    luminanceFloor,
    cloudCover: round(averageCloud),
    horizonContrast: round(clamp(0.24 + (1 - averageCloud) * 0.32, 0.2, 0.62)),
    blackBackgroundGuard: luminanceFloor >= 0.12,
  };
};

const buildWeather = (samples) => {
  const totals = samples.reduce((accumulator, sample) => {
    accumulator.cloud += sample.weather.cloud;
    accumulator.precipitation += sample.weather.precipitation;
    accumulator.wind += sample.weather.wind;
    accumulator.snow += sample.weather.snowLikelihood;
    accumulator.rain += sample.weather.rainLikelihood;
    return accumulator;
  }, { cloud: 0, precipitation: 0, wind: 0, snow: 0, rain: 0 });
  const divisor = Math.max(samples.length, 1);
  const cloud = totals.cloud / divisor;
  const precipitation = totals.precipitation / divisor;
  const wind = totals.wind / divisor;
  const snow = totals.snow / divisor;
  const rain = totals.rain / divisor;
  const className = snow > 0.45 ? 'snow' : rain > 0.35 ? 'rain' : wind > 0.72 ? 'wind' : cloud > 0.6 ? 'cloudy' : 'clear';
  return {
    class: className,
    intensity: round(clamp(Math.max(precipitation, wind * 0.72, cloud * 0.5), 0, MAX_WEATHER_INTENSITY)),
    precipitation: round(precipitation),
    wind: round(wind),
    snowLikelihood: round(snow),
    rainLikelihood: round(rain),
    particleBudgetHint: Math.round(clamp(200 + precipitation * 1400 + wind * 400, 0, 2200)),
    audioWindGain: round(clamp(wind * 0.72, 0, 0.8)),
  };
};

const buildAudioZones = (samples) => samples
  .filter((sample) => sample.visibility >= 0.18)
  .sort((left, right) => left.distance - right.distance || left.id.localeCompare(right.id))
  .slice(0, MAX_AUDIO_ZONE_COUNT)
  .map((sample) => ({
    id: `atmo:${sample.id}`,
    center: sample.position,
    biome: sample.biome,
    waterProximity: round(clamp(1 - sample.waterDistance / 900, 0, 1)),
    windGain: round(clamp(sample.weather.wind * 0.72 + sample.horizonOcclusion * 0.12, 0, 0.82)),
    precipitationGain: round(sample.weather.precipitation * 0.68),
    reverbWet: round(clamp(sample.moisture * 0.28 + sample.horizonOcclusion * 0.22, 0, 0.5)),
  }));

const buildQuality = (samples, framePressure = 0) => {
  const pressure = clamp(finite(framePressure, 0), 0, 1);
  const detailTier = pressure > 0.8 ? 'reduced' : pressure > 0.55 ? 'balanced' : 'full';
  return {
    detailTier,
    fogStep: round(detailTier === 'reduced' ? 0.08 : detailTier === 'balanced' ? 0.04 : 0.02),
    weatherParticleScale: round(detailTier === 'reduced' ? 0.42 : detailTier === 'balanced' ? 0.72 : 1),
    audioZoneBudget: Math.max(8, Math.round(MAX_AUDIO_ZONE_COUNT * (detailTier === 'reduced' ? 0.35 : detailTier === 'balanced' ? 0.65 : 1))),
    lodBias: round(detailTier === 'reduced' ? 1.35 : detailTier === 'balanced' ? 1.12 : 1),
  };
};

export function createEnvironmentAtmosphereWeatherContract(input = {}) {
  const seed = Number.isFinite(input.seed) ? Math.trunc(input.seed) : DEFAULT_SEED;
  const rawSamples = Array.isArray(input.samples) ? input.samples.slice(0, MAX_SAMPLES) : [];
  const samples = rawSamples.map((sample, index) => normalizeSample(sample, index, seed));
  const fog = buildFog(samples);
  const sky = buildSky(samples);
  const weather = buildWeather(samples);
  const audioZones = buildAudioZones(samples);
  const quality = buildQuality(samples, input.framePressure);
  const camera = {
    profile: 'orthographic-90deg',
    width: 1536,
    height: 1024,
    deterministicSeed: seed,
    coverage: ['full-world', 'far', 'near-center', 'near-northwest'],
  };
  const summary = {
    sampleCount: samples.length,
    visibleSampleCount: samples.filter((sample) => sample.visibility >= 0.18).length,
    weatherClass: weather.class,
    audioZoneCount: audioZones.length,
    fogDensity: fog.density,
    blackSkyGuard: sky.blackBackgroundGuard,
    failClosed: rawSamples.length > MAX_SAMPLES,
  };
  const payload = {
    version: 'v50',
    seed,
    camera,
    sky,
    fog,
    weather,
    quality,
    audioZones,
    samples,
    summary,
  };
  const digest = hash32(stableStringify(payload)).toString(16).padStart(8, '0');
  return deepFreeze({ ...payload, digest, serialization: stableStringify({ ...payload, digest }) });
}

export function applyEnvironmentAtmosphereWeatherContract(target, contract) {
  if (!target || typeof target !== 'object') return false;
  if (!contract || typeof contract !== 'object') return false;
  target.environmentAtmosphereWeather = contract;
  return true;
}

export const ENVIRONMENT_ATMOSPHERE_WEATHER_CONTRACT_V50 = Object.freeze({
  version: 'v50',
  maxSamples: MAX_SAMPLES,
  maxFogDensity: MAX_FOG_DENSITY,
  maxWeatherIntensity: MAX_WEATHER_INTENSITY,
  maxAudioZoneCount: MAX_AUDIO_ZONE_COUNT,
  camera: 'orthographic-90deg-1536x1024',
  cameraRelativeSky: true,
  blackSkyFloor: 0.12,
  ownerBoundary: 'caller-owned-renderer-sky-fog-weather-audio',
});
