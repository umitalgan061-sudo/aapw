// V67 deterministic environment runtime core
// Read-only policy layer: it computes world signals but never mutates the scene.

export const V67_POLICY = Object.freeze({
  id: 'environment-runtime-v67',
  version: 67,
  deterministic: true,
  noWorldMutation: true,
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  materialAuthority: 'MaterialAssignmentCore.js',
  coordinateSpace: 'world',
});

export const clamp01 = (value) => {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
};

export const finiteV67 = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const meanV67 = (values = []) => {
  const valid = values.map(Number).filter(Number.isFinite);
  return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : 0;
};

export const hashV67 = (input = '') => {
  let hash = 2166136261;
  for (const char of String(input)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const normalizeSampleV67 = (sample = {}, index = 0) => ({
  id: sample.id ?? `sample-${index}`,
  elevation: finiteV67(sample.elevation, 0),
  slope: clamp01(finiteV67(sample.slope, 0) / 90),
  moisture: clamp01(sample.moisture),
  temperature: finiteV67(sample.temperature, 12),
  humidity: clamp01(sample.humidity ?? 0.6),
  wind: clamp01(finiteV67(sample.wind, 0) / 50),
  visibility: clamp01(sample.visibility ?? 0.8),
  rain: clamp01(sample.rain),
  snow: clamp01(sample.snow),
  canopy: clamp01(sample.canopy ?? 0.5),
  waterDistance: Math.max(0, finiteV67(sample.waterDistance, 1000)),
  humanPressure: clamp01(sample.humanPressure),
  biome: sample.biome ?? 'temperate',
});

export const normalizeSamplesV67 = (samples = [], limit = 64) =>
  samples.slice(0, limit).map(normalizeSampleV67);

export const normalizedDigestV67 = (samples = []) =>
  hashV67(normalizeSamplesV67(samples).map((sample) => JSON.stringify(sample)).join('|'));

export const signalV67 = ({ value = 0, weight = 1, label = 'signal' } = {}) => ({
  label,
  value: clamp01(value),
  weight: Math.max(0, finiteV67(weight, 1)),
});

export const weightedSignalV67 = (signals = []) => {
  const total = signals.reduce((sum, item) => sum + Math.max(0, finiteV67(item?.weight, 0)), 0);
  if (!total) return 0;
  return clamp01(signals.reduce((sum, item) => sum + clamp01(item?.value) * Math.max(0, item?.weight ?? 0), 0) / total);
};

export const seasonPhaseV67 = (dayOfYear = 180) => {
  const day = ((Math.floor(finiteV67(dayOfYear, 180)) % 365) + 365) % 365;
  if (day < 80) return 'winter';
  if (day < 172) return 'spring';
  if (day < 264) return 'summer';
  if (day < 355) return 'autumn';
  return 'winter';
};

export const daylightV67 = (hour = 12) => {
  const h = ((finiteV67(hour, 12) % 24) + 24) % 24;
  return clamp01((Math.sin(((h - 6) / 12) * Math.PI) + 0.08) / 1.08);
};

export const thermalComfortV67 = (temperature = 12) =>
  clamp01(1 - Math.abs(finiteV67(temperature, 12) - 14) / 30);

export const slopeDifficultyV67 = (slope = 0) =>
  clamp01(Math.max(0, finiteV67(slope, 0) - 8) / 70);

export const moistureStressV67 = (moisture = 0.5) =>
  clamp01(Math.abs(clamp01(moisture) - 0.58) / 0.58);

export const visibilitySafetyV67 = (visibility = 0.8) =>
  clamp01(0.2 + clamp01(visibility) * 0.8);

export const environmentalScoreV67 = (sample = {}) => {
  const s = normalizeSampleV67(sample);
  return weightedSignalV67([
    signalV67({ value: thermalComfortV67(s.temperature), weight: 0.22, label: 'thermal' }),
    signalV67({ value: 1 - slopeDifficultyV67(s.slope * 90), weight: 0.18, label: 'slope' }),
    signalV67({ value: 1 - moistureStressV67(s.moisture), weight: 0.18, label: 'moisture' }),
    signalV67({ value: visibilitySafetyV67(s.visibility), weight: 0.18, label: 'visibility' }),
    signalV67({ value: 1 - s.humanPressure, weight: 0.12, label: 'disturbance' }),
    signalV67({ value: 1 - s.wind * 0.6, weight: 0.12, label: 'wind' }),
  ]);
};

export const buildRuntimeFrameV67 = ({ samples = [], clock = 12, dayOfYear = 180, seed = 67 } = {}) => {
  const normalized = normalizeSamplesV67(samples);
  const scores = normalized.map(environmentalScoreV67);
  const phase = seasonPhaseV67(dayOfYear);
  const daylight = daylightV67(clock);
  return Object.freeze({
    policy: V67_POLICY.id,
    version: 67,
    phase,
    clock: finiteV67(clock, 12),
    daylight,
    sampleCount: normalized.length,
    meanScore: meanV67(scores),
    digest: hashV67(`${seed}:${phase}:${clock}:${normalizedDigestV67(normalized)}`),
    samples: normalized,
    immutable: true,
  });
};

export const validateRuntimeFrameV67 = (runtime = {}) => {
  const errors = [];
  if (runtime.policy !== V67_POLICY.id) errors.push('policy');
  if (runtime.version !== 67) errors.push('version');
  if (runtime.immutable !== true) errors.push('immutable');
  if (!Array.isArray(runtime.samples)) errors.push('samples');
  if (!Number.isFinite(runtime.meanScore)) errors.push('mean-score');
  if (!runtime.digest) errors.push('digest');
  return { ok: errors.length === 0, errors };
};

export const compareRuntimeFramesV67 = (before = {}, after = {}) => ({
  sameDigest: before.digest === after.digest,
  scoreDelta: finiteV67(after.meanScore) - finiteV67(before.meanScore),
  sampleDelta: finiteV67(after.sampleCount) - finiteV67(before.sampleCount),
});

export const contractSnapshotV67 = () => Object.freeze({
  policy: V67_POLICY.id,
  deterministic: V67_POLICY.deterministic,
  noWorldMutation: V67_POLICY.noWorldMutation,
  placementAuthority: V67_POLICY.placementAuthority,
  materialAuthority: V67_POLICY.materialAuthority,
});

export const createScenarioV67 = (overrides = {}) => ({
  id: overrides.id ?? 'temperate-baseline',
  dayOfYear: finiteV67(overrides.dayOfYear, 180),
  clock: finiteV67(overrides.clock, 12),
  precipitation: clamp01(overrides.precipitation),
  wind: clamp01(overrides.wind),
  visibility: clamp01(overrides.visibility ?? 0.8),
  ...overrides,
});

export const scenarioSeedV67 = (scenario = {}) => hashV67(JSON.stringify(createScenarioV67(scenario)));

export const projectScenarioSampleV67 = (sample = {}, scenario = {}) => ({
  ...normalizeSampleV67(sample),
  rain: clamp01(scenario.precipitation ?? sample.rain),
  wind: clamp01(scenario.wind ?? sample.wind),
  visibility: clamp01(scenario.visibility ?? sample.visibility),
});

export const buildScenarioFrameV67 = ({ samples = [], scenario = {} } = {}) => {
  const s = createScenarioV67(scenario);
  return buildRuntimeFrameV67({
    samples: samples.map((sample) => projectScenarioSampleV67(sample, s)),
    clock: s.clock,
    dayOfYear: s.dayOfYear,
    seed: scenarioSeedV67(s),
  });
};

export const stableJsonV67 = (value) => JSON.stringify(value, Object.keys(value ?? {}).sort());

export const releaseEvidenceV67 = (runtime = {}) => ({
  deterministic: runtime?.contract?.deterministic === true || V67_POLICY.deterministic,
  mutationSafe: runtime?.contract?.noWorldMutation === true || V67_POLICY.noWorldMutation,
  digestPresent: Boolean(runtime?.digest),
  sampleCount: runtime?.sampleCount ?? runtime?.runtime?.sampleCount ?? 0,
});

export const runtimeSummaryV67 = (runtime = {}) => ({
  version: 67,
  digest: runtime.digest ?? runtime.runtime?.digest ?? hashV67(JSON.stringify(runtime)),
  meanScore: runtime.meanScore ?? runtime.runtime?.meanScore ?? 0,
  phase: runtime.phase ?? runtime.runtime?.phase ?? 'unknown',
  sampleCount: runtime.sampleCount ?? runtime.runtime?.sampleCount ?? 0,
});

export const isReadOnlyPolicyV67 = (runtime = {}) =>
  (runtime?.contract?.noWorldMutation ?? V67_POLICY.noWorldMutation) === true;
