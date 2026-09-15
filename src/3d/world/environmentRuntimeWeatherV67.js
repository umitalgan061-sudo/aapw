import { clamp01, finiteV67, hashV67, meanV67, normalizeSampleV67 } from './environmentRuntimeV67.js';

export const WEATHER_V67 = Object.freeze({
  id: 'weather-v67',
  version: 67,
  deterministic: true,
  noWorldMutation: true,
});

export const precipitationPhaseV67 = ({ temperature = 10, humidity = 0.6, intensity = 0.2 } = {}) => {
  if (intensity < 0.08) return 'none';
  if (temperature <= -2) return 'snow';
  if (temperature < 2 && humidity > 0.74) return 'sleet';
  if (humidity > 0.55) return 'rain';
  return 'drizzle';
};

export const pressureGradientV67 = (pressure = 1013, neighborPressure = 1013) =>
  clamp01(Math.abs(finiteV67(pressure, 1013) - finiteV67(neighborPressure, 1013)) / 24);

export const precipitationIntensityV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  const lowPressure = clamp01((1017 - finiteV67(sample.pressure, 1013)) / 20);
  return clamp01(lowPressure * 0.52 + s.humidity * 0.28 + s.rain * 0.2);
};

export const gustMagnitudeV67 = (sample = {}, seed = '67') => {
  const s = normalizeSampleV67(sample);
  const noise = parseInt(hashV67(`${seed}:${s.id}`), 16) / 0xffffffff;
  return Math.max(0, finiteV67(sample.wind, s.wind * 50) * (0.78 + noise * 0.54));
};

export const stormPotentialV67 = (sample = {}) => clamp01(
  precipitationIntensityV67(sample) * 0.55 +
  normalizeSampleV67(sample).wind * 0.25 +
  pressureGradientV67(sample.pressure, sample.neighborPressure) * 0.2,
);

export const buildWeatherCellV67 = (sample = {}, seed = '67') => {
  const s = normalizeSampleV67(sample);
  const intensity = precipitationIntensityV67(s);
  const phase = precipitationPhaseV67({
    temperature: s.temperature,
    humidity: s.humidity,
    intensity,
  });
  return {
    id: s.id,
    phase,
    intensity,
    gust: gustMagnitudeV67(s, seed),
    storm: stormPotentialV67(s),
    pressure: finiteV67(sample.pressure, 1013),
  };
};

export const buildWeatherFieldV67 = (samples = [], seed = '67') =>
  samples.map((sample) => buildWeatherCellV67(sample, seed));

export const weatherPersistenceV67 = (field = [], hours = 6) => {
  const base = meanV67(field.map((x) => x.intensity));
  const duration = clamp01(finiteV67(hours, 6) / 24);
  return clamp01(base * 0.72 + duration * 0.28);
};

export const weatherSeverityV67 = (cell = {}) =>
  clamp01(cell.intensity * 0.4 + cell.storm * 0.42 + Math.min(1, cell.gust / 50) * 0.18);

export const weatherClassV67 = (severity = 0) => {
  if (severity >= 0.8) return 'severe';
  if (severity >= 0.56) return 'active';
  if (severity >= 0.3) return 'light';
  return 'calm';
};

export const weatherSummaryV67 = (field = []) => ({
  samples: field.length,
  meanIntensity: meanV67(field.map((x) => x.intensity)),
  meanSeverity: meanV67(field.map(weatherSeverityV67)),
  severe: field.filter((x) => weatherSeverityV67(x) >= 0.8).length,
  rain: field.filter((x) => x.phase === 'rain').length,
  snow: field.filter((x) => x.phase === 'snow').length,
});

export const validateWeatherV67 = (field = []) => {
  const errors = [];
  if (!Array.isArray(field)) errors.push('field');
  if (field.some((x) => x.intensity < 0 || x.intensity > 1)) errors.push('intensity');
  if (field.some((x) => !['none', 'snow', 'sleet', 'rain', 'drizzle'].includes(x.phase))) errors.push('phase');
  return { ok: errors.length === 0, errors };
};

export const weatherTelemetryV67 = (field = []) => ({
  policy: WEATHER_V67.id,
  valid: validateWeatherV67(field).ok,
  summary: weatherSummaryV67(field),
});

export const forecastWeatherV67 = ({ samples = [], seed = '67', horizon = 6 } = {}) => {
  const source = samples.map(normalizeSampleV67);
  return Array.from({ length: Math.max(1, Math.min(24, horizon)) }, (_, step) =>
    buildWeatherFieldV67(
      source.map((sample) => ({
        ...sample,
        rain: clamp01(sample.rain + (step % 3) * 0.05),
        wind: Math.max(0, sample.wind * 50 + (step - 2) * 1.5),
      })),
      `${seed}:${step}`,
    ),
  );
};

export const weatherDeltaV67 = (before = {}, after = {}) => ({
  intensity: finiteV67(after.intensity) - finiteV67(before.intensity),
  storm: finiteV67(after.storm) - finiteV67(before.storm),
  gust: finiteV67(after.gust) - finiteV67(before.gust),
});
