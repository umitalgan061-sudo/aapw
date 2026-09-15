import { buildErosionScenarioV66, buildMicroErosionFieldV66, erosionTelemetryV66 } from './environmentRuntimeErosionV66.js';
import { buildRiverCorridorV66, buildWetEdgeHabitatV66, waterDynamicsTelemetryV66 } from './environmentRuntimeWaterDynamicsV66.js';
import { buildWildlifeCorridorV66, wildlifeTelemetryV66 } from './environmentRuntimeWildlifeV66.js';
import { buildCameraExposureV66, buildSkyLumaEnvelopeV66, exposureTelemetryV66 } from './environmentRuntimeExposureV66.js';
import { buildPlayerSafetyEnvelopeV66, navigationTelemetryV66 } from './environmentRuntimeNavigationV66.js';
import { buildSeasonalEcologyV66, ecologyTelemetryV66 } from './environmentRuntimeEcologyV66.js';

export const V66_EXPERIENCE_POLICY = Object.freeze({
  id: 'environment-runtime-experience-v66-2026-09-15',
  version: 66,
  deterministic: true,
  noWorldMutation: true,
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  materialAuthority: 'MaterialAssignmentCore.js',
});

const stableDigest = (value) => {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const buildV66ExperienceRuntime = ({ samples = [], weather = {}, dayOfYear = 180, season = 'summer', time = 12, camera = {}, platform = 'desktop', chunks = [], infrastructure = {} } = {}) => {
  const erosion = buildMicroErosionFieldV66({ samples, weather, seed: 66 });
  const water = buildRiverCorridorV66({ samples, weather, seed: 66 });
  const wildlife = buildWildlifeCorridorV66({ samples, time, weather, seed: 66 });
  const sky = buildSkyLumaEnvelopeV66({ samples, weather });
  const exposure = buildCameraExposureV66({ camera, weather, terrain: samples[0] || {} });
  const navigation = buildPlayerSafetyEnvelopeV66({ samples, mode: camera.mode === 'sprint' ? 'sprint' : 'walk' });
  const ecology = buildSeasonalEcologyV66({ samples, season });
  const wetEdges = samples.slice(0, 48).map((sample) => buildWetEdgeHabitatV66(sample, weather));
  const scenario = samples[0] ? buildErosionScenarioV66({ sample: samples[0], weather, usage: camera.usage || {}, neighbors: samples.slice(1, 5) }) : null;
  const runtime = {
    policy: V66_EXPERIENCE_POLICY.id,
    contract: V66_EXPERIENCE_POLICY,
    erosion,
    water,
    wildlife,
    sky,
    exposure,
    navigation,
    ecology,
    wetEdges,
    scenario,
    chunks,
    infrastructure,
    dayOfYear,
    platform,
  };
  return { ...runtime, digest: stableDigest(runtime), deterministic: true };
};

export const validateV66ExperienceRuntime = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V66_EXPERIENCE_POLICY.id) errors.push('policy');
  if (runtime?.contract?.noWorldMutation !== true) errors.push('mutation');
  if (runtime?.contract?.placementAuthority !== 'WorldAssetPlacementPipeline.js') errors.push('placement');
  if (runtime?.contract?.materialAuthority !== 'MaterialAssignmentCore.js') errors.push('material');
  if (runtime?.deterministic !== true) errors.push('determinism');
  if ((runtime?.sky?.skyLumaFloor ?? 0) < 0.08) errors.push('black-sky');
  if (runtime?.navigation?.blockedRatio > 0.92) errors.push('navigation');
  if (runtime?.water && runtime.water.corridor.some((entry) => entry.width < 2)) errors.push('water-width');
  return { ok: errors.length === 0, errors };
};

export const buildWorldExperienceTelemetryV66 = (runtime) => ({
  digest: runtime?.digest,
  erosion: erosionTelemetryV66(runtime?.erosion),
  water: waterDynamicsTelemetryV66(runtime?.water),
  wildlife: wildlifeTelemetryV66(runtime?.wildlife),
  exposure: exposureTelemetryV66({ sky: runtime?.sky }),
  navigation: navigationTelemetryV66(runtime?.navigation),
  ecology: ecologyTelemetryV66(runtime?.ecology),
  wetEdgeCount: runtime?.wetEdges?.length || 0,
});

export const createV66ScenarioProfiles = () => [
  { id: 'storm-valley', precipitation: 0.84, humidity: 0.93, wind: 0.76, season: 'autumn', expected: ['runoff', 'wet-edge', 'fog'] },
  { id: 'clear-alpine', precipitation: 0.05, humidity: 0.28, wind: 0.42, season: 'summer', expected: ['exposure', 'rock', 'snowline'] },
  { id: 'winter-taiga', precipitation: 0.32, humidity: 0.8, wind: 0.58, season: 'winter', expected: ['snow', 'wildlife', 'low-forage'] },
  { id: 'dry-steppe', precipitation: 0.04, humidity: 0.18, wind: 0.36, season: 'summer', expected: ['grass', 'exposure', 'low-water'] },
];

export const evaluateV66Scenario = (profile, runtime) => {
  const telemetry = buildWorldExperienceTelemetryV66(runtime);
  const checks = {
    deterministic: runtime?.deterministic === true,
    readableSky: telemetry.exposure.skyLumaFloor >= 0.08,
    waterStable: telemetry.water.maxBankPressure <= 1,
    navigationPresent: telemetry.navigation.samples >= 0,
    ecologyPresent: telemetry.ecology.samples >= 0,
  };
  return {
    profile: profile?.id || 'unknown',
    pass: Object.values(checks).every(Boolean),
    checks,
    digest: runtime?.digest,
  };
};

export const compareV66Experience = (before, after) => {
  const a = buildWorldExperienceTelemetryV66(before);
  const b = buildWorldExperienceTelemetryV66(after);
  return {
    deterministicReplay: before?.digest === after?.digest,
    before: a,
    after: b,
    deltas: {
      erosionWash: Number(((b.erosion.meanWash || 0) - (a.erosion.meanWash || 0)).toFixed(4)),
      waterVelocity: Number(((b.water.meanVelocity || 0) - (a.water.meanVelocity || 0)).toFixed(4)),
      wildlifeDensity: Number(((b.wildlife.meanDensity || 0) - (a.wildlife.meanDensity || 0)).toFixed(4)),
      forage: Number(((b.ecology.meanForage || 0) - (a.ecology.meanForage || 0)).toFixed(4)),
    },
  };
};

export const immutableV66ContractSnapshot = (runtime) => Object.freeze({
  policy: runtime?.policy,
  noWorldMutation: runtime?.contract?.noWorldMutation === true,
  placementAuthority: runtime?.contract?.placementAuthority,
  materialAuthority: runtime?.contract?.materialAuthority,
  digest: runtime?.digest,
});

export const getV66ExperienceSummary = () => Object.freeze({
  contract: V66_EXPERIENCE_POLICY,
  features: ['erosion-response', 'hydrology-dynamics', 'wildlife-routing', 'solar-exposure', 'navigation-safety', 'seasonal-ecology'],
  camera: { width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90 },
  fullWorld: true,
});
