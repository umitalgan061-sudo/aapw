const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const smoothstep = (edge0, edge1, x) => { const t = clamp((x - edge0) / Math.max(1e-6, edge1 - edge0)); return t * t * (3 - 2 * t); };
const hash = (seed, text) => { let h = (2166136261 ^ seed) >>> 0; for (const c of String(text)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };

export const V66_WATER_POLICY = Object.freeze({
  id: 'environment-runtime-water-dynamics-v66-2026-09-15',
  version: 66,
  deterministic: true,
  mutation: false,
  shallowBand: 18,
  foamBand: 7,
  floodLookahead: 120,
  dischargeWindow: 64,
});

export const normalizeHydrologySampleV66 = (sample = {}) => ({
  x: Number(sample.x) || 0,
  z: Number(sample.z) || 0,
  elevation: Number(sample.elevation) || 0,
  slope: clamp(sample.slope, 0, 90),
  rainfall: clamp(sample.rainfall ?? sample.precipitation),
  upstream: clamp(sample.upstream ?? 0),
  soilSaturation: clamp(sample.soilSaturation ?? sample.moisture),
  waterDistance: Math.max(0, Number(sample.waterDistance) || 99999),
  flow: Math.max(0, Number(sample.flow) || 0),
  channelWidth: Math.max(0, Number(sample.channelWidth) || 0),
  bankHeight: Math.max(0, Number(sample.bankHeight) || 0),
  biome: sample.biome || 'grassland',
});

export const buildWaterSurfaceStateV66 = (sample, weather = {}, time = 0.5) => {
  const s = normalizeHydrologySampleV66(sample);
  const rain = clamp(weather.precipitation ?? s.rainfall);
  const wind = clamp(weather.wind ?? 0.2);
  const tide = clamp(weather.tide ?? 0.5);
  const wave = clamp(wind * 0.58 + rain * 0.22 + tide * 0.2);
  const shallow = smoothstep(0, V66_WATER_POLICY.shallowBand, s.waterDistance);
  const foam = 1 - smoothstep(0, V66_WATER_POLICY.foamBand, s.waterDistance);
  const ripple = ((hash(66, `${s.x}:${s.z}:${Math.floor(time * 12)}`) % 1000) / 1000);
  return {
    depthClass: s.waterDistance <= 2 ? 'water' : s.waterDistance <= V66_WATER_POLICY.shallowBand ? 'shallows' : 'bank',
    wave,
    ripple: clamp(ripple * 0.54 + wave * 0.46),
    foamStrength: clamp(foam * (0.55 + wave * 0.45)),
    transparency: clamp(0.24 + shallow * 0.46),
    microNormalStrength: clamp(0.18 + wave * 0.56),
    shorelineWetness: clamp((1 - shallow) * 0.58 + rain * 0.24 + s.soilSaturation * 0.18),
    specularBreakup: clamp(0.34 + wave * 0.44 + ripple * 0.12),
  };
};

export const computeDischargeV66 = (sample, weather = {}, upstream = []) => {
  const s = normalizeHydrologySampleV66(sample);
  const rain = clamp(weather.precipitation ?? s.rainfall);
  const upstreamFlow = upstream.length ? upstream.reduce((sum, item) => sum + normalizeHydrologySampleV66(item).flow, 0) / upstream.length : s.upstream;
  const infiltrationLoss = clamp(s.soilSaturation * 0.46 + (1 - clamp(s.slope / 45)) * 0.16);
  const localRunoff = Math.max(0, rain * (1 - infiltrationLoss));
  const discharge = Math.max(0, s.flow + upstreamFlow * 0.62 + localRunoff * 8);
  return {
    discharge,
    localRunoff,
    upstreamContribution: upstreamFlow * 0.62,
    velocity: discharge / Math.max(1, s.channelWidth + 1),
    bankPressure: clamp(discharge / Math.max(1, s.bankHeight * 18 + 8)),
  };
};

export const predictFloodRiskV66 = (sample, weather = {}, forecast = {}) => {
  const s = normalizeHydrologySampleV66(sample);
  const d = computeDischargeV66(s, { precipitation: weather.precipitation, ...weather }, forecast.upstream || []);
  const forecastRain = clamp(forecast.rainfall ?? weather.precipitation ?? 0);
  const soil = clamp(s.soilSaturation + forecastRain * 0.34);
  const lowBank = clamp(1 - s.bankHeight / 6);
  const risk = clamp(d.bankPressure * 0.46 + soil * 0.3 + lowBank * 0.24);
  return {
    risk,
    class: risk > 0.78 ? 'critical' : risk > 0.54 ? 'elevated' : risk > 0.3 ? 'watch' : 'stable',
    projectedDischarge: Number((d.discharge * (1 + forecastRain * 0.7)).toFixed(4)),
    bankOvertopping: clamp(risk * (0.56 + lowBank * 0.44)),
    lookaheadSeconds: Number(forecast.lookaheadSeconds ?? V66_WATER_POLICY.floodLookahead),
  };
};

export const buildRiverCorridorV66 = ({ samples = [], weather = {}, seed = 66 } = {}) => {
  const ordered = [...samples].map(normalizeHydrologySampleV66).sort((a, b) => a.z - b.z || a.x - b.x);
  const corridor = ordered.map((sample, index) => {
    const previous = ordered[Math.max(0, index - 1)];
    const next = ordered[Math.min(ordered.length - 1, index + 1)];
    const tangent = { x: next.x - previous.x, z: next.z - previous.z };
    const len = Math.max(0.001, Math.hypot(tangent.x, tangent.z));
    const discharge = computeDischargeV66(sample, weather, previous ? [previous] : []);
    const surface = buildWaterSurfaceStateV66(sample, weather, ((hash(seed, `${sample.x}:${sample.z}`) % 1000) / 1000));
    return {
      x: sample.x,
      z: sample.z,
      direction: { x: tangent.x / len, z: tangent.z / len },
      width: Math.max(2, sample.channelWidth + discharge.velocity * 0.9),
      discharge: Number(discharge.discharge.toFixed(4)),
      velocity: Number(discharge.velocity.toFixed(4)),
      foam: Number(surface.foamStrength.toFixed(4)),
      bankPressure: Number(discharge.bankPressure.toFixed(4)),
    };
  });
  return { policy: V66_WATER_POLICY.id, deterministic: true, corridor };
};

export const buildWetEdgeHabitatV66 = (sample, weather = {}) => {
  const s = normalizeHydrologySampleV66(sample);
  const water = buildWaterSurfaceStateV66(s, weather);
  const flood = predictFloodRiskV66(s, weather);
  return {
    riparian: clamp((1 - smoothstep(0, 45, s.waterDistance)) * 0.72 + s.soilSaturation * 0.28),
    reed: clamp(water.shorelineWetness * 0.44 + flood.risk * 0.2 + (1 - s.slope / 50) * 0.36),
    mud: clamp(water.shorelineWetness * 0.64 + flood.bankOvertopping * 0.36),
    gravel: clamp((1 - water.shorelineWetness) * 0.54 + clamp(s.slope / 60) * 0.46),
    floodRisk: flood.risk,
  };
};

export const validateWaterDynamicsV66 = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_WATER_POLICY.id) errors.push('policy');
  if (runtime?.deterministic !== true) errors.push('determinism');
  for (const item of runtime?.corridor || []) {
    if (item.width < 2) errors.push('width');
    if (item.velocity < 0) errors.push('velocity');
    if (item.foam < 0 || item.foam > 1) errors.push('foam');
  }
  return { ok: errors.length === 0, errors };
};

export const waterDynamicsTelemetryV66 = (corridor) => {
  const items = corridor?.corridor || [];
  const mean = (key) => items.length ? items.reduce((sum, item) => sum + Number(item[key] || 0), 0) / items.length : 0;
  return {
    samples: items.length,
    meanWidth: Number(mean('width').toFixed(3)),
    meanVelocity: Number(mean('velocity').toFixed(3)),
    meanFoam: Number(mean('foam').toFixed(3)),
    maxBankPressure: items.length ? Math.max(...items.map((item) => item.bankPressure)) : 0,
    deterministic: corridor?.deterministic === true,
  };
};

export const getV66WaterSummary = () => Object.freeze({
  contract: V66_WATER_POLICY,
  features: ['surface-wave', 'discharge', 'flood-risk', 'river-corridor', 'wet-edge-habitat'],
  authority: 'read-only-hydrology-intent',
});
