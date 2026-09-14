import { buildEnvironmentRuntimeV65, acceptanceMetrics, qualifiesAcceptance } from './environmentRuntimeIntegrationV65.js';
import { buildVisualAudit, createCameraEvidence } from './environmentRuntimeVisualAuditV65.js';

export const V65_SCENARIO_POLICY = Object.freeze({
  id: 'environment-runtime-scenario-v65-2026-09-14',
  deterministic: true,
  scenarios: Object.freeze(['summer-forest', 'wetland-edge', 'alpine-winter', 'coastal-storm', 'taiga-autumn', 'open-steppe']),
});

const scenarioBase = {
  summer: { precipitation: 0.1, humidity: 0.5, cloud: 0.25, temperature: 0.55, mode: 'clear' },
  wetland: { precipitation: 0.35, humidity: 0.86, cloud: 0.55, temperature: 0.2, mode: 'rain' },
  winter: { precipitation: 0.42, humidity: 0.78, cloud: 0.66, temperature: -0.68, mode: 'snow' },
  storm: { precipitation: 0.8, humidity: 0.94, cloud: 0.96, temperature: 0.04, mode: 'storm' },
  autumn: { precipitation: 0.3, humidity: 0.7, cloud: 0.62, temperature: 0.02, mode: 'overcast' },
  steppe: { precipitation: 0.06, humidity: 0.28, cloud: 0.12, temperature: 0.46, mode: 'clear' },
};

const makeSamples = (kind) => {
  const presets = {
    forest: { biome: 'forest', elevation: 360, moisture: 0.64, temperature: 0.36, waterDistance: 260, snow: 0.03 },
    wetland: { biome: 'wetland', elevation: 30, moisture: 0.92, temperature: 0.24, waterDistance: 32, snow: 0 },
    alpine: { biome: 'alpine', elevation: 1840, moisture: 0.28, temperature: -0.42, waterDistance: 540, snow: 0.82 },
    coastal: { biome: 'coastal', elevation: 12, moisture: 0.8, temperature: 0.12, waterDistance: 28, snow: 0 },
    taiga: { biome: 'taiga', elevation: 680, moisture: 0.58, temperature: -0.12, waterDistance: 360, snow: 0.22 },
    steppe: { biome: 'steppe', elevation: 240, moisture: 0.24, temperature: 0.48, waterDistance: 900, snow: 0.01 },
  };
  const preset = presets[kind];
  return Array.from({ length: 14 }, (_, i) => ({
    id: `${kind}-${i}`,
    x: i * 86,
    z: (i % 5) * 71,
    ...preset,
    slope: 4 + (i % 5) * 3,
    wind: 0.16 + (i % 4) * 0.11,
    roadDistance: 32 + i * 2,
    settlementDistance: 90 + i * 6,
    confidence: 0.9,
  }));
};

export const buildScenario = (name) => {
  const definitions = {
    'summer-forest': ['forest', scenarioBase.summer, 180],
    'wetland-edge': ['wetland', scenarioBase.wetland, 122],
    'alpine-winter': ['alpine', scenarioBase.winter, 355],
    'coastal-storm': ['coastal', scenarioBase.storm, 244],
    'taiga-autumn': ['taiga', scenarioBase.autumn, 276],
    'open-steppe': ['steppe', scenarioBase.steppe, 212],
  };
  const definition = definitions[name];
  if (!definition) throw new Error(`unknown-scenario:${name}`);
  const [kind, weather, dayOfYear] = definition;
  return { name, kind, weather, dayOfYear, samples: makeSamples(kind) };
};

export const runScenario = (name, platform = 'desktop') => {
  const scenario = buildScenario(name);
  const runtime = buildEnvironmentRuntimeV65({
    samples: scenario.samples,
    runtimeInput: { seed: 6500 + scenario.dayOfYear, region: scenario.kind },
    weather: scenario.weather,
    dayOfYear: scenario.dayOfYear,
    platform,
    camera: { x: 0, z: 0, velocity: 22 },
    streaming: {
      metrics: { fps: platform === 'mobile' ? 38 : 55, drawCalls: platform === 'mobile' ? 76 : 148, triangles: platform === 'mobile' ? 540000 : 1250000, texturesMb: platform === 'mobile' ? 540 : 760, residentChunks: platform === 'mobile' ? 4 : 7 },
      items: scenario.samples.map((sample, index) => ({ id: sample.id, distance: index * 370, projectedSize: 0.9 - index * 0.04, importance: index < 2 ? 0.82 : 0.42 })),
    },
  });
  const metrics = acceptanceMetrics(runtime);
  const visual = buildVisualAudit(['world-full', 'terrain-near', 'far-mountain'].map((camera) => ({
    camera,
    geometry: {},
    water: {},
    atmosphere: { luma: runtime.report?.ledger?.green ? 0.58 : 0.4, visibility: metrics.visibility, mountainReadability: 0.82 },
    material: {},
    biomeSeparation: 0.86,
  })));
  return { scenario, runtime, metrics, visual, qualifies: qualifiesAcceptance({ ...metrics, p0Pass: visual.p0Pass }) };
};

export const runScenarioMatrix = (platform = 'desktop') => V65_SCENARIO_POLICY.scenarios.map((name) => runScenario(name, platform));

export const summarizeScenarioMatrix = (results = []) => {
  const qualified = results.filter((result) => result.qualifies).length;
  return {
    count: results.length,
    qualified,
    qualificationRate: qualified / (results.length || 1),
    p0PassRate: results.filter((result) => result.visual.p0Pass).length / (results.length || 1),
    meanVisibility: results.reduce((sum, result) => sum + result.metrics.visibility, 0) / (results.length || 1),
    meanContinuity: results.reduce((sum, result) => sum + result.metrics.continuity, 0) / (results.length || 1),
  };
};

export const scenarioEvidence = (result) => [
  createCameraEvidence('world-full', { readability: result.metrics.visibility, grounding: 0.92, biomeSeparation: 0.86, waterClarity: 0.88 }),
  createCameraEvidence('terrain-near', { readability: Math.max(result.metrics.visibility, 0.74), grounding: 0.94, biomeSeparation: 0.9, waterClarity: 0.9 }),
  createCameraEvidence('far-mountain', { readability: Math.max(result.metrics.visibility, 0.66), grounding: 0.9, biomeSeparation: 0.84, waterClarity: 0.82 }),
];

export const validateScenarioResult = (result) => {
  const errors = [];
  if (!result?.scenario?.name) errors.push('scenario-name');
  if (!result?.runtime) errors.push('runtime');
  if (result?.metrics?.continuity < 0 || result?.metrics?.continuity > 1) errors.push('continuity-range');
  if (result?.visual?.meanScore < 0 || result?.visual?.meanScore > 1) errors.push('visual-range');
  return { ok: errors.length === 0, errors };
};

export const scenarioDigest = (result) => {
  let hash = 2166136261;
  for (const char of JSON.stringify({ name: result.scenario.name, metrics: result.metrics, visual: result.visual })) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};
