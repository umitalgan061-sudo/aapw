import { buildAdaptiveRuntimePlan, adaptiveTelemetry } from './environmentRuntimeAdaptiveV65.js';
import { surfaceRuntimeSummary } from './environmentRuntimeSurfaceV65.js';
import { buildContinuityEnvelope } from './environmentRuntimeContinuityV65.js';
import { buildFrameEnvelope, streamingTelemetry } from './environmentRuntimeStreamingV65.js';
import { buildPhenologyField, phenologySummary } from './environmentRuntimePhenologyV65.js';
import { buildReadOnlyBatch, querySummary } from './environmentRuntimeQueryV65.js';
import { buildRuntimeReport } from './environmentRuntimeObservabilityV65.js';

export const V65_INTEGRATION_POLICY = Object.freeze({
  id: 'environment-runtime-integration-v65-2026-09-14',
  version: 65,
  deterministic: true,
  noWorldMutation: true,
  sharedPlacementAuthority: 'WorldAssetPlacementPipeline.js',
  sharedMaterialAuthority: 'MaterialAssignmentCore.js',
});

export const buildEnvironmentRuntimeV65 = ({ samples = [], runtimeInput = {}, weather = {}, dayOfYear = 180, chunks = {}, streaming = {}, camera = {}, platform = 'desktop' } = {}) => {
  const adaptive = buildAdaptiveRuntimePlan({ samples, runtimeInput, seed: runtimeInput.seed ?? 65 });
  const surface = surfaceRuntimeSummary(samples, weather);
  const keySamples = samples.slice(0, 24);
  const continuity = buildContinuityEnvelope({ chunks, camera });
  const frame = buildFrameEnvelope({ ...streaming, platform, camera });
  const phenology = phenologySummary(buildPhenologyField(keySamples, dayOfYear));
  const query = buildReadOnlyBatch(keySamples, { weather, dayOfYear, chunks, streaming: { ...streaming, platform, camera } });
  const report = buildRuntimeReport({ adaptive, surface, continuity, streaming: frame, phenology });
  return {
    policy: V65_INTEGRATION_POLICY.id,
    contract: V65_INTEGRATION_POLICY,
    adaptive,
    surface,
    continuity,
    streaming: frame,
    phenology,
    query,
    report,
    telemetry: {
      adaptive: adaptiveTelemetry(adaptive),
      continuity: continuity,
      streaming: streamingTelemetry(frame),
      query: querySummary(query),
    },
  };
};

export const validateIntegratedRuntime = (runtime) => {
  const errors = [];
  if (runtime?.policy !== V65_INTEGRATION_POLICY.id) errors.push('policy');
  if (runtime?.contract?.noWorldMutation !== true) errors.push('mutation-contract');
  if (runtime?.contract?.sharedPlacementAuthority !== 'WorldAssetPlacementPipeline.js') errors.push('placement-authority');
  if (runtime?.contract?.sharedMaterialAuthority !== 'MaterialAssignmentCore.js') errors.push('material-authority');
  if (!runtime?.adaptive?.decisions) errors.push('adaptive');
  if (!runtime?.surface?.validated) errors.push('surface');
  if (!runtime?.continuity?.seamSafe) errors.push('continuity');
  if (!runtime?.query?.safe) errors.push('query');
  return { ok: errors.length === 0, errors };
};

export const createAcceptanceProfileV65 = (overrides = {}) => ({
  id: overrides.id || 'v65-orthographic-1536x1024',
  width: 1536,
  height: 1024,
  projection: 'orthographic',
  fovDegrees: 90,
  fullWorld: true,
  terrainNear: true,
  farMountains: true,
  water: true,
  biomeTransitions: true,
  determinism: true,
  ...overrides,
});

export const acceptanceMetrics = (runtime) => ({
  adaptiveAcceptance: runtime?.adaptive?.summary?.acceptanceRate ?? 0,
  visibility: runtime?.surface?.meanVisibility ?? 0,
  continuity: runtime?.continuity?.matrix?.meanContinuityRate ?? 0,
  budgetUsage: runtime?.streaming?.usage?.max ?? 0,
  evidenceScore: runtime?.report?.ledger?.evidenceScore ?? 0,
  p0Pass: runtime?.report?.p0?.every((x) => x.pass) ?? false,
});

export const qualifiesAcceptance = (metrics) => metrics.adaptiveAcceptance >= 0.55 && metrics.visibility >= 0.3 && metrics.continuity >= 0.72 && metrics.budgetUsage <= 1.18 && metrics.p0Pass;

export const runtimeDigest = (runtime) => {
  let hash = 2166136261;
  for (const char of JSON.stringify(runtime)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const compareRuntime = (before, after) => ({
  sameDigest: runtimeDigest(before) === runtimeDigest(after),
  before: acceptanceMetrics(before),
  after: acceptanceMetrics(after),
  qualifyingBefore: qualifiesAcceptance(acceptanceMetrics(before)),
  qualifyingAfter: qualifiesAcceptance(acceptanceMetrics(after)),
});

export const immutableContractSnapshot = (runtime) => Object.freeze({
  policy: runtime?.policy,
  noWorldMutation: runtime?.contract?.noWorldMutation === true,
  placementAuthority: runtime?.contract?.sharedPlacementAuthority,
  materialAuthority: runtime?.contract?.sharedMaterialAuthority,
  digest: runtimeDigest(runtime),
});
