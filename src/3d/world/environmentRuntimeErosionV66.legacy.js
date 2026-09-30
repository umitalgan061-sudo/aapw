const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const hash = (seed, value) => { let h = (seed ^ 2166136261) >>> 0; for (const c of String(value)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const noise = (seed, x, z, octave = 0) => ((hash(seed + octave * 2654435761, `${Math.round(x * 10)}:${Math.round(z * 10)}`) % 10000) / 10000) * 2 - 1;
const smooth = (a, b, t) => a + (b - a) * t;

export const V66_EROSION_POLICY = Object.freeze({
  id: 'environment-runtime-erosion-v66-2026-09-15',
  version: 66,
  deterministic: true,
  worldMutation: false,
  maxSlope: 58,
  runoffRadius: 42,
  sedimentScale: 0.84,
});

export const normalizeTerrainSampleV66 = (sample = {}) => ({
  x: Number(sample.x) || 0,
  z: Number(sample.z) || 0,
  elevation: Number(sample.elevation) || 0,
  slope: clamp(sample.slope, 0, 90),
  moisture: clamp(sample.moisture),
  rainfall: clamp(sample.rainfall ?? sample.precipitation),
  runoff: clamp(sample.runoff),
  soilDepth: clamp(sample.soilDepth ?? 0.55),
  vegetationCover: clamp(sample.vegetationCover ?? 0.5),
  rockExposure: clamp(sample.rockExposure ?? 0.15),
  waterDistance: Math.max(0, Number(sample.waterDistance) || 99999),
  confidence: clamp(sample.confidence ?? 1),
  biome: sample.biome || 'grassland',
});

export const computeRainImpactV66 = (sample, weather = {}) => {
  const t = normalizeTerrainSampleV66(sample);
  const rain = clamp(weather.precipitation ?? weather.rainfall ?? t.rainfall);
  const humidity = clamp(weather.humidity ?? t.moisture);
  const pulse = clamp(weather.stormPulse ?? 0);
  const slopeFactor = clamp(t.slope / 42, 0, 1);
  const infiltration = clamp((t.soilDepth * 0.72 + (1 - t.rockExposure) * 0.28) * (1 - slopeFactor * 0.42));
  const runoff = clamp(rain * (0.55 + pulse * 0.45) * (1 - infiltration) + humidity * 0.18);
  const saturation = clamp(t.moisture * 0.52 + rain * 0.38 + humidity * 0.1);
  return {
    rain,
    humidity,
    infiltration,
    runoff,
    saturation,
    erosionPotential: clamp(runoff * (0.42 + slopeFactor * 0.58) * (1 - t.vegetationCover * 0.48)),
  };
};

export const computeSedimentBudgetV66 = (sample, weather = {}, neighbors = []) => {
  const t = normalizeTerrainSampleV66(sample);
  const impact = computeRainImpactV66(t, weather);
  const neighborSlope = neighbors.length ? neighbors.reduce((sum, item) => sum + normalizeTerrainSampleV66(item).slope, 0) / neighbors.length : t.slope;
  const shear = clamp(((t.slope + neighborSlope) * 0.5) / V66_EROSION_POLICY.maxSlope);
  const sediment = clamp(impact.erosionPotential * (0.58 + shear * 0.42) * V66_EROSION_POLICY.sedimentScale);
  const deposition = clamp(sediment * (1 - shear) * (0.35 + (1 - impact.runoff) * 0.65));
  return {
    sediment,
    deposition,
    exportRate: clamp(sediment - deposition),
    channelBias: clamp(impact.runoff * (0.4 + shear * 0.6)),
    confidence: t.confidence,
  };
};

export const buildMicroErosionFieldV66 = ({ seed = 66, samples = [], weather = {}, radius = 42 } = {}) => {
  const source = samples.map(normalizeTerrainSampleV66);
  const field = source.map((sample, index) => {
    const neighbors = source.filter((other, otherIndex) => {
      if (otherIndex === index) return false;
      const dx = other.x - sample.x;
      const dz = other.z - sample.z;
      return Math.hypot(dx, dz) <= radius;
    });
    const sediment = computeSedimentBudgetV66(sample, weather, neighbors);
    const phase = (noise(seed, sample.x, sample.z, 1) + 1) * 0.5;
    return {
      ...sample,
      index,
      flowVector: { x: smooth(-1, 1, phase), z: smooth(-1, 1, 1 - phase) },
      sediment: Number((sediment.sediment * (0.92 + phase * 0.08)).toFixed(6)),
      deposition: Number(sediment.deposition.toFixed(6)),
      channelBias: Number(sediment.channelBias.toFixed(6)),
      washStrength: Number(clamp(sediment.exportRate * (0.7 + phase * 0.3)).toFixed(6)),
    };
  });
  return {
    policy: V66_EROSION_POLICY.id,
    seed,
    radius,
    count: field.length,
    field,
    deterministic: true,
  };
};

export const classifyTerrainWearV66 = (sample, erosion = {}, usage = {}) => {
  const t = normalizeTerrainSampleV66(sample);
  const e = erosion.field?.find((item) => item.index === usage.sampleIndex) || erosion.field?.[0] || computeSedimentBudgetV66(t);
  const traffic = clamp(usage.traffic ?? 0);
  const grazing = clamp(usage.grazing ?? 0);
  const freezeThaw = clamp(usage.freezeThaw ?? 0);
  const stream = clamp(e.channelBias ?? 0);
  const wear = clamp(traffic * 0.36 + grazing * 0.16 + stream * 0.3 + freezeThaw * 0.18);
  return {
    class: wear > 0.72 ? 'severe' : wear > 0.44 ? 'moderate' : wear > 0.18 ? 'light' : 'stable',
    wear,
    rutting: clamp(traffic * (1 - t.soilDepth) * 0.62),
    exposedRoots: clamp(wear * t.vegetationCover * 0.46),
    exposedRock: clamp(t.rockExposure + e.sediment * 0.22),
    puddleProbability: clamp(t.moisture * 0.42 + stream * 0.4 + (1 - t.slope / 45) * 0.18),
  };
};

export const buildBankStabilityV66 = (sample, weather = {}, usage = {}) => {
  const t = normalizeTerrainSampleV66(sample);
  const rain = computeRainImpactV66(t, weather);
  const traffic = clamp(usage.traffic);
  const factor = 1 - clamp(t.slope / 65) * 0.42 - rain.saturation * 0.28 - traffic * 0.16;
  const rootHold = clamp(t.vegetationCover * 0.62 + t.soilDepth * 0.24 + (1 - t.rockExposure) * 0.14);
  return {
    stability: clamp(factor * 0.72 + rootHold * 0.28),
    slippageRisk: clamp(1 - factor),
    toeErosionRisk: clamp(rain.runoff * (1 - rootHold)),
    mitigation: t.slope > 36 ? 'rock-reinforced-bank' : rain.runoff > 0.55 ? 'drainage-bias' : 'vegetation-retention',
  };
};

export const buildErosionScenarioV66 = ({ seed = 66, sample = {}, weather = {}, usage = {}, neighbors = [] } = {}) => {
  const normalized = normalizeTerrainSampleV66(sample);
  const rain = computeRainImpactV66(normalized, weather);
  const sediment = computeSedimentBudgetV66(normalized, weather, neighbors);
  const erosion = buildMicroErosionFieldV66({ seed, samples: [normalized, ...neighbors], weather }).field[0];
  const wear = classifyTerrainWearV66(normalized, { field: [erosion] }, usage);
  const stability = buildBankStabilityV66(normalized, weather, usage);
  return {
    sample: normalized,
    rain,
    sediment,
    erosion,
    wear,
    stability,
    surfaceIntent: {
      dirtBlend: clamp(erosion.washStrength * 0.66 + wear.wear * 0.34),
      rockBreakup: clamp(normalized.rockExposure * 0.72 + stability.slippageRisk * 0.28),
      waterMarks: clamp(rain.runoff * 0.58 + rain.saturation * 0.42),
    },
  };
};

export const validateErosionFieldV66 = (field) => {
  const errors = [];
  if (!field || field.policy !== V66_EROSION_POLICY.id) errors.push('policy');
  if (field?.deterministic !== true) errors.push('determinism');
  if (!Array.isArray(field?.field)) errors.push('field');
  for (const item of field?.field || []) {
    if (item.sediment < 0 || item.sediment > 1) errors.push('sediment-range');
    if (item.deposition < 0 || item.deposition > 1) errors.push('deposition-range');
    if (item.washStrength < 0 || item.washStrength > 1) errors.push('wash-range');
  }
  return { ok: errors.length === 0, errors };
};

export const erosionTelemetryV66 = (field) => {
  const items = field?.field || [];
  const mean = (key) => items.length ? items.reduce((sum, item) => sum + (Number(item[key]) || 0), 0) / items.length : 0;
  return {
    sampleCount: items.length,
    meanSediment: Number(mean('sediment').toFixed(4)),
    meanDeposition: Number(mean('deposition').toFixed(4)),
    meanWash: Number(mean('washStrength').toFixed(4)),
    highFlowCount: items.filter((item) => item.channelBias > 0.65).length,
    deterministic: field?.deterministic === true,
  };
};

export const compareErosionFieldsV66 = (before, after) => ({
  sameDigest: JSON.stringify(before) === JSON.stringify(after),
  before: erosionTelemetryV66(before),
  after: erosionTelemetryV66(after),
  deltaWash: Number((erosionTelemetryV66(after).meanWash - erosionTelemetryV66(before).meanWash).toFixed(4)),
  deltaSediment: Number((erosionTelemetryV66(after).meanSediment - erosionTelemetryV66(before).meanSediment).toFixed(4)),
});

export const getV66ErosionSummary = () => Object.freeze({
  contract: V66_EROSION_POLICY,
  features: ['rain-runoff', 'sediment-budget', 'micro-flow', 'terrain-wear', 'bank-stability'],
  authority: 'read-only-surface-intent',
});
