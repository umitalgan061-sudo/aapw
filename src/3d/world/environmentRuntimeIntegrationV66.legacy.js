import { buildMicroErosionFieldV66, validateErosionFieldV66 } from './environmentRuntimeErosionV66.js';
import { buildRiverCorridorV66, validateWaterDynamicsV66 } from './environmentRuntimeWaterDynamicsV66.js';
import { buildWildlifeCorridorV66, validateWildlifeRuntimeV66 } from './environmentRuntimeWildlifeV66.js';
import { buildSkyLumaEnvelopeV66, validateExposureRuntimeV66 } from './environmentRuntimeExposureV66.js';
import { buildPlayerSafetyEnvelopeV66, validateNavigationRuntimeV66 } from './environmentRuntimeNavigationV66.js';
import { buildSeasonalEcologyV66, validateEcologyRuntimeV66 } from './environmentRuntimeEcologyV66.js';
import { synthesizeEnvironmentEventsV66, collapseOverlappingEventsV66, validateEnvironmentEventsV66 } from './environmentRuntimeEventsV66.js';
import { auditEnvironmentV66 } from './environmentRuntimeV66Audit.js';
import { buildV66ExperienceRuntime, buildWorldExperienceTelemetryV66 } from './environmentRuntimeExperienceV66.js';

export const V66_INTEGRATION_POLICY = Object.freeze({
  id: 'environment-runtime-integration-v66-2026-09-15',
  version: 66,
  deterministic: true,
  noWorldMutation: true,
  placementAuthority: 'WorldAssetPlacementPipeline.js',
  materialAuthority: 'MaterialAssignmentCore.js',
});

export const buildEnvironmentRuntimeV66 = ({ samples = [], weather = {}, dayOfYear = 180, season = 'summer', time = 12, camera = {}, platform = 'desktop', infrastructure = {} } = {}) => {
  const experience = buildV66ExperienceRuntime({ samples, weather, dayOfYear, season, time, camera, platform, infrastructure });
  const contexts = samples.slice(0, 18).map((sample) => ({ ...sample, ...weather, time }));
  const eventsRuntime = synthesizeEnvironmentEventsV66({ contexts, seed: 66 });
  const collapsedEvents = collapseOverlappingEventsV66(eventsRuntime.events);
  const runtime = {
    ...experience,
    eventsRuntime: { ...eventsRuntime, events: collapsedEvents },
    eventVisualIntents: collapsedEvents.map((event) => ({ id: event.id, type: event.type, intent: event.type })),
    auditInput: true,
  };
  const audit = auditEnvironmentV66(runtime);
  return { ...runtime, audit, telemetry: buildWorldExperienceTelemetryV66(runtime) };
};

export const validateEnvironmentRuntimeV66 = (runtime) => {
  const errors = [];
  const erosion = validateErosionFieldV66(runtime?.erosion);
  const water = validateWaterDynamicsV66(runtime?.water);
  const wildlife = validateWildlifeRuntimeV66(runtime?.wildlife);
  const exposure = validateExposureRuntimeV66({ policy: 'environment-runtime-exposure-v66-2026-09-15', deterministic: true, sky: runtime?.sky });
  const navigation = validateNavigationRuntimeV66({ policy: 'environment-runtime-navigation-v66-2026-09-15', deterministic: true, field: runtime?.navigation?.field || [], blockedRatio: runtime?.navigation?.blockedRatio || 0, meanRisk: runtime?.navigation?.meanRisk || 0 });
  const ecology = validateEcologyRuntimeV66({ policy: 'environment-runtime-ecology-v66-2026-09-15', deterministic: true, ...runtime?.ecology });
  const events = validateEnvironmentEventsV66(runtime?.eventsRuntime);
  for (const [name, result] of Object.entries({ erosion, water, wildlife, exposure, navigation, ecology, events })) if (!result.ok) errors.push(...result.errors.map((error) => `${name}:${error}`));
  if (runtime?.policy !== 'environment-runtime-experience-v66-2026-09-15') errors.push('experience-policy');
  if (runtime?.contract?.noWorldMutation !== true) errors.push('mutation-contract');
  if (runtime?.contract?.placementAuthority !== V66_INTEGRATION_POLICY.placementAuthority) errors.push('placement-authority');
  if (runtime?.contract?.materialAuthority !== V66_INTEGRATION_POLICY.materialAuthority) errors.push('material-authority');
  if (runtime?.audit?.pass !== true) errors.push('audit');
  return { ok: errors.length === 0, errors };
};

export const createV66IntegrationSnapshot = (runtime) => Object.freeze({
  policy: V66_INTEGRATION_POLICY.id,
  digest: runtime?.digest,
  auditPass: runtime?.audit?.pass === true,
  noWorldMutation: runtime?.contract?.noWorldMutation === true,
  sampleCount: runtime?.telemetry?.navigation?.samples || 0,
  eventCount: runtime?.eventsRuntime?.events?.length || 0,
});

export const compareV66Integrations = (before, after) => ({
  sameDigest: before?.digest === after?.digest,
  before: createV66IntegrationSnapshot(before),
  after: createV66IntegrationSnapshot(after),
  auditImproved: after?.audit?.pass === true && before?.audit?.pass !== true,
});

export const getV66IntegrationSummary = () => Object.freeze({
  contract: V66_INTEGRATION_POLICY,
  systems: ['erosion', 'water', 'wildlife', 'exposure', 'navigation', 'ecology', 'events', 'audit'],
  acceptance: { width: 1536, height: 1024, projection: 'orthographic', fovDegrees: 90 },
});
