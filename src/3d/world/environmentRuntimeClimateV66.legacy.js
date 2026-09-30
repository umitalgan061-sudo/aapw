const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const cycle = (day) => Math.sin(((day - 81) / 365) * Math.PI * 2);

export const V66_CLIMATE_POLICY = Object.freeze({
  id: 'environment-runtime-climate-v66-2026-09-15',
  version: 66,
  deterministic: true,
  mutation: false,
  days: 365,
  horizonDays: 14,
});

export const normalizeClimateInputV66 = (input = {}) => ({
  dayOfYear: Math.max(1, Math.min(365, Number(input.dayOfYear) || 180)),
  latitude: Number(input.latitude) || 41,
  baselineTemperature: Number(input.baselineTemperature) || 0.52,
  baselineMoisture: clamp(input.baselineMoisture ?? 0.5),
  elevation: Number(input.elevation) || 0,
  continentality: clamp(input.continentality ?? 0.4),
  biome: input.biome || 'grassland',
});

export const computeSeasonalClimateV66 = (input = {}) => {
  const s = normalizeClimateInputV66(input);
  const wave = cycle(s.dayOfYear);
  const latitudeFactor = clamp(Math.abs(s.latitude) / 70);
  const elevationCooling = clamp(s.elevation / 3500) * 0.24;
  const amplitude = 0.1 + latitudeFactor * 0.32 + s.continentality * 0.08;
  const temperature = clamp(s.baselineTemperature + wave * amplitude - elevationCooling);
  const moistureSeasonal = clamp(s.baselineMoisture - wave * 0.12 + (1 - latitudeFactor) * 0.06);
  const daylight = clamp(0.52 + wave * 0.38);
  return { temperature, moisture: moistureSeasonal, daylight, wave, latitudeFactor, elevationCooling };
};

export const classifyClimatePhaseV66 = (input = {}) => {
  const climate = computeSeasonalClimateV66(input);
  if (climate.temperature < 0.22) return 'winter';
  if (climate.temperature > 0.74) return 'summer';
  if (climate.wave > 0.2) return 'spring';
  if (climate.wave < -0.2) return 'autumn';
  return 'shoulder';
};

export const buildDailyWeatherEnvelopeV66 = ({ input = {}, forecast = 0, seed = 66 } = {}) => {
  const base = computeSeasonalClimateV66(input);
  const entries = [];
  for (let i = 0; i <= forecast; i += 1) {
    const day = normalizeClimateInputV66(input).dayOfYear + i;
    const climate = computeSeasonalClimateV66({ ...input, dayOfYear: ((day - 1) % 365) + 1 });
    const jitter = ((Math.imul((seed + i) ^ 0x45d9f3b, 2654435761) >>> 0) % 1000) / 1000;
    const precipitation = clamp(0.18 + (1 - climate.temperature) * 0.24 + climate.moisture * 0.34 + jitter * 0.1);
    const wind = clamp(0.18 + Math.abs(climate.wave) * 0.36 + jitter * 0.2);
    entries.push({ day: ((day - 1) % 365) + 1, phase: classifyClimatePhaseV66({ ...input, dayOfYear: ((day - 1) % 365) + 1 }), temperature: climate.temperature, moisture: climate.moisture, precipitation, wind, daylight: climate.daylight });
  }
  return { policy: V66_CLIMATE_POLICY.id, deterministic: true, base, entries };
};

export const buildSnowlineV66 = (input = {}) => {
  const s = normalizeClimateInputV66(input);
  const climate = computeSeasonalClimateV66(s);
  const base = 1450 - climate.temperature * 520;
  const latitude = Math.abs(s.latitude - 41) * 9;
  return { elevation: Math.max(250, base + latitude), breakupBand: 180 + climate.moisture * 120, persistence: clamp((1 - climate.temperature) * 0.62 + s.elevation / 4200 * 0.38) };
};

export const buildClimateBiomeModifierV66 = (input = {}) => {
  const phase = classifyClimatePhaseV66(input);
  const climate = computeSeasonalClimateV66(input);
  const multipliers = {
    forest: { canopy: 1, grass: 1, moss: 1 },
    taiga: { canopy: 0.92, grass: 0.82, moss: 1.08 },
    wetland: { canopy: 0.72, grass: 1.14, moss: 1.16 },
    alpine: { canopy: 0.34, grass: 0.76, moss: 1.1 },
    tundra: { canopy: 0.08, grass: 0.42, moss: 1.18 },
    steppe: { canopy: 0.12, grass: 0.96, moss: 0.52 },
    grassland: { canopy: 0.08, grass: 1.08, moss: 0.48 },
    coastal: { canopy: 0.18, grass: 0.96, moss: 0.72 },
    desert: { canopy: 0.01, grass: 0.12, moss: 0.02 },
  };
  const base = multipliers[input.biome] || multipliers.grassland;
  const stress = clamp(Math.abs(climate.temperature - 0.5) * 1.4);
  return {
    phase,
    canopy: base.canopy * (1 - stress * 0.2),
    grass: base.grass * (1 - stress * 0.16),
    moss: base.moss * (0.72 + climate.moisture * 0.28),
    frostStress: clamp((0.32 - climate.temperature) * 1.6),
    droughtStress: clamp((climate.temperature - 0.72) * 1.8 + (0.34 - climate.moisture)),
  };
};

export const validateClimateRuntimeV66 = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_CLIMATE_POLICY.id) errors.push('policy');
  if (runtime?.deterministic !== true) errors.push('determinism');
  for (const entry of runtime?.entries || []) if (entry.temperature < 0 || entry.temperature > 1 || entry.precipitation < 0 || entry.precipitation > 1) errors.push('range');
  return { ok: errors.length === 0, errors };
};

export const climateTelemetryV66 = (runtime) => ({ entries: runtime?.entries?.length || 0, meanTemperature: runtime?.entries?.length ? Number((runtime.entries.reduce((s, i) => s + i.temperature, 0) / runtime.entries.length).toFixed(4)) : 0, meanMoisture: runtime?.entries?.length ? Number((runtime.entries.reduce((s, i) => s + i.moisture, 0) / runtime.entries.length).toFixed(4)) : 0 });

export const getV66ClimateSummary = () => Object.freeze({ contract: V66_CLIMATE_POLICY, phases: ['winter', 'spring', 'summer', 'autumn', 'shoulder'], features: ['seasonal-climate', 'weather-envelope', 'snowline', 'biome-modifier'] });
