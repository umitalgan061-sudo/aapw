import {
  clamp01,
  finiteV67,
  meanV67,
  normalizeSampleV67,
  seasonPhaseV67,
} from './environmentRuntimeV67.js';

export const CLIMATE_V67 = Object.freeze({
  id: 'climate-v67',
  version: 67,
  deterministic: true,
  noWorldMutation: true,
});

const SEASONAL_BIAS = Object.freeze({
  winter: { temperature: -8, precipitation: 0.18, snow: 0.72 },
  spring: { temperature: 3, precipitation: 0.34, snow: 0.18 },
  summer: { temperature: 10, precipitation: 0.14, snow: 0.01 },
  autumn: { temperature: 2, precipitation: 0.29, snow: 0.12 },
});

const BIOME_RANGE = Object.freeze({
  alpine: { min: -16, max: 10 },
  tundra: { min: -18, max: 8 },
  taiga: { min: -12, max: 18 },
  forest: { min: -8, max: 28 },
  grassland: { min: -4, max: 34 },
  scrub: { min: 2, max: 36 },
  wetland: { min: 0, max: 32 },
  temperate: { min: -4, max: 32 },
});

export const degreeDaysV67 = (temperature = 12, base = 5) =>
  Math.max(0, finiteV67(temperature, 12) - base);

export const freezePotentialV67 = (temperature = 5) =>
  clamp01((2 - finiteV67(temperature, 5)) / 14);

export const thawPotentialV67 = (temperature = 5) =>
  clamp01((finiteV67(temperature, 5) - 1) / 16);

export const seasonalTemperatureV67 = (dayOfYear = 180) => {
  const phase = seasonPhaseV67(dayOfYear);
  return SEASONAL_BIAS[phase].temperature;
};

export const seasonalPrecipitationV67 = (dayOfYear = 180) => {
  const phase = seasonPhaseV67(dayOfYear);
  return SEASONAL_BIAS[phase].precipitation;
};

export const seasonalSnowPotentialV67 = (dayOfYear = 180) => {
  const phase = seasonPhaseV67(dayOfYear);
  return SEASONAL_BIAS[phase].snow;
};

export const biomeThermalFitV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  const range = BIOME_RANGE[s.biome] ?? BIOME_RANGE.temperate;
  if (s.temperature < range.min) {
    return clamp01(1 - (range.min - s.temperature) / 18);
  }
  if (s.temperature > range.max) {
    return clamp01(1 - (s.temperature - range.max) / 18);
  }
  return 1;
};

export const biomeSnowFitV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  const altitude = clamp01((s.elevation - 650) / 1400);
  const cold = freezePotentialV67(s.temperature);
  return clamp01(altitude * 0.58 + cold * 0.42);
};

export const climateStressV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  const thermal = 1 - biomeThermalFitV67(s);
  const dryness = clamp01((0.44 - s.moisture) / 0.44);
  const freezeThaw = freezePotentialV67(s.temperature) * thawPotentialV67(s.temperature);
  return clamp01(thermal * 0.5 + dryness * 0.3 + freezeThaw * 0.2);
};

export const buildClimateSampleV67 = (sample = {}, dayOfYear = 180) => {
  const s = normalizeSampleV67(sample);
  const phase = seasonPhaseV67(dayOfYear);
  const seasonalDelta = seasonalTemperatureV67(dayOfYear);
  const expectedPrecipitation = seasonalPrecipitationV67(dayOfYear);
  const snowPotential = seasonalSnowPotentialV67(dayOfYear);
  return {
    id: s.id,
    phase,
    degreeDays: degreeDaysV67(s.temperature + seasonalDelta * 0.2),
    freezePotential: freezePotentialV67(s.temperature + seasonalDelta * 0.15),
    thawPotential: thawPotentialV67(s.temperature + seasonalDelta * 0.15),
    thermalFit: biomeThermalFitV67(s),
    snowPotential: clamp01(snowPotential * 0.68 + biomeSnowFitV67(s) * 0.32),
    expectedPrecipitation,
    stress: climateStressV67(s),
  };
};

export const buildClimateFieldV67 = (samples = [], dayOfYear = 180) =>
  samples.map((sample) => buildClimateSampleV67(sample, dayOfYear));

export const snowlineElevationV67 = (sample = {}, dayOfYear = 180) => {
  const climate = buildClimateSampleV67(sample, dayOfYear);
  return 820 + climate.freezePotential * 620 - climate.thawPotential * 310;
};

export const seasonalGroundModifierV67 = (sample = {}, dayOfYear = 180) => {
  const climate = buildClimateSampleV67(sample, dayOfYear);
  return clamp01(0.35 + climate.snowPotential * 0.45 + climate.stress * 0.2);
};

export const climateSummaryV67 = (field = []) => ({
  samples: field.length,
  meanStress: meanV67(field.map((x) => x.stress)),
  meanSnowPotential: meanV67(field.map((x) => x.snowPotential)),
  freezeSamples: field.filter((x) => x.freezePotential > 0.55).length,
  thawSamples: field.filter((x) => x.thawPotential > 0.55).length,
});

export const validateClimateV67 = (field = []) => {
  const errors = [];
  if (!Array.isArray(field)) errors.push('field');
  if (field.some((x) => x.stress < 0 || x.stress > 1)) errors.push('stress');
  if (field.some((x) => x.snowPotential < 0 || x.snowPotential > 1)) errors.push('snow');
  return { ok: errors.length === 0, errors };
};

export const climateTelemetryV67 = (field = []) => ({
  policy: CLIMATE_V67.id,
  valid: validateClimateV67(field).ok,
  summary: climateSummaryV67(field),
});

export const scenarioClimateDeltaV67 = (base = {}, dayOfYear = 180, modifier = {}) => {
  const climate = buildClimateSampleV67(base, dayOfYear);
  const stressDelta = finiteV67(modifier.stress, 0);
  const snowDelta = finiteV67(modifier.snow, 0);
  return {
    stress: clamp01(climate.stress + stressDelta),
    snowPotential: clamp01(climate.snowPotential + snowDelta),
    phase: climate.phase,
  };
};

export const climateEnvelopeV67 = ({ samples = [], dayOfYear = 180 } = {}) => {
  const field = buildClimateFieldV67(samples, dayOfYear);
  return {
    policy: CLIMATE_V67.id,
    field,
    summary: climateSummaryV67(field),
    validated: validateClimateV67(field).ok,
  };
};
