import { buildEnvironmentRuntimeV65 } from './environmentRuntimeIntegrationV65.js';
import { getEnvironmentRuntimeV65Manifest } from './environmentRuntimeV65Manifest.js';
import { V65_SCENARIO_POLICY } from './environmentRuntimeScenarioV65.js';

export const V65_BRIDGE_POLICY = Object.freeze({
  id: 'environment-runtime-bridge-v65-2026-09-14',
  deterministic: true,
  readOnly: true,
  expectedVersion: 65,
  owners: Object.freeze({ material: 'MaterialAssignmentCore.js', placement: 'WorldAssetPlacementPipeline.js', geography: 'geographicAssetClusterPlanner.js' }),
});

const finite = (value, fallback = 0) => Number.isFinite(value) ? value : fallback;
const clamp = (value, min, max) => Math.min(max, Math.max(min, finite(value, min)));
const digest = (value) => {
  let hash = 2166136261;
  for (const char of JSON.stringify(value)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

export const bridgeInput = (input = {}) => ({
  samples: Array.isArray(input.samples) ? input.samples.slice(0, 512) : [],
  runtimeInput: { ...(input.runtimeInput || {}) },
  weather: { ...(input.weather || {}) },
  dayOfYear: finite(input.dayOfYear, 180),
  platform: input.platform === 'mobile' ? 'mobile' : 'desktop',
  camera: { x: finite(input.camera?.x), z: finite(input.camera?.z), velocity: Math.max(0, finite(input.camera?.velocity)) },
  chunks: input.chunks && typeof input.chunks === 'object' ? input.chunks : {},
  streaming: input.streaming && typeof input.streaming === 'object' ? input.streaming : {},
});

export const buildBridgeRuntime = (input = {}) => {
  const normalized = bridgeInput(input);
  const runtime = buildEnvironmentRuntimeV65(normalized);
  const manifest = getEnvironmentRuntimeV65Manifest();
  return {
    policy: V65_BRIDGE_POLICY.id,
    runtime,
    manifest,
    scenarioPolicy: V65_SCENARIO_POLICY,
    digest: digest({ runtime, manifest }),
  };
};

export const bridgeHealth = (bridge) => {
  const runtime = bridge?.runtime;
  const checks = [
    ['policy', bridge?.policy === V65_BRIDGE_POLICY.id],
    ['version', bridge?.manifest?.version === V65_BRIDGE_POLICY.expectedVersion],
    ['deterministic', bridge?.manifest?.deterministic === true],
    ['no-world-mutation', bridge?.runtime?.contract?.noWorldMutation === true],
    ['material-owner', bridge?.runtime?.contract?.sharedMaterialAuthority === V65_BRIDGE_POLICY.owners.material],
    ['placement-owner', bridge?.runtime?.contract?.sharedPlacementAuthority === V65_BRIDGE_POLICY.owners.placement],
    ['geography-owner', bridge?.manifest?.features?.includes('adaptive-habitat') === true],
    ['adaptive', runtime?.adaptive?.summary?.sampleCount !== undefined],
    ['surface', runtime?.surface?.sampleCount !== undefined],
    ['streaming', Boolean(runtime?.streaming)],
    ['query', Boolean(runtime?.query)],
    ['observability', Boolean(runtime?.report)],
  ];
  return { checks: checks.map(([id, pass]) => ({ id, pass })), healthy: checks.every(([, pass]) => pass) };
};

export const bridgeMetrics = (bridge) => {
  const runtime = bridge?.runtime || {};
  return {
    sampleCount: runtime.adaptive?.summary?.sampleCount || 0,
    acceptedCount: runtime.adaptive?.summary?.accepted || 0,
    acceptanceRate: clamp(runtime.adaptive?.summary?.acceptanceRate || 0, 0, 1),
    visibility: clamp(runtime.surface?.meanVisibility || 0, 0, 1),
    continuity: clamp(runtime.continuity?.matrix?.meanContinuityRate || 0, 0, 1),
    budgetUsage: Math.max(0, finite(runtime.streaming?.usage?.max, 0)),
    evidenceScore: clamp(runtime.report?.ledger?.evidenceScore || 0, 0, 1),
    p0Pass: runtime.report?.p0?.every((item) => item.pass) === true,
  };
};

export const riskBands = (metrics) => ({
  habitat: metrics.acceptanceRate >= 0.7 ? 'good' : metrics.acceptanceRate >= 0.55 ? 'target' : 'risk',
  visibility: metrics.visibility >= 0.65 ? 'good' : metrics.visibility >= 0.3 ? 'target' : 'risk',
  continuity: metrics.continuity >= 0.85 ? 'good' : metrics.continuity >= 0.72 ? 'target' : 'risk',
  budget: metrics.budgetUsage <= 0.82 ? 'good' : metrics.budgetUsage <= 1.18 ? 'target' : 'risk',
  evidence: metrics.evidenceScore >= 0.82 ? 'good' : metrics.evidenceScore >= 0.65 ? 'target' : 'risk',
  p0: metrics.p0Pass ? 'good' : 'risk',
});

export const buildBridgeReport = (bridge) => {
  const health = bridgeHealth(bridge);
  const metrics = bridgeMetrics(bridge);
  return { policy: V65_BRIDGE_POLICY.id, health, metrics, risk: riskBands(metrics), digest: bridge?.digest || null };
};

export const compareBridgeReports = (before, after) => ({
  acceptanceDelta: (after?.metrics?.acceptanceRate || 0) - (before?.metrics?.acceptanceRate || 0),
  visibilityDelta: (after?.metrics?.visibility || 0) - (before?.metrics?.visibility || 0),
  continuityDelta: (after?.metrics?.continuity || 0) - (before?.metrics?.continuity || 0),
  budgetDelta: (after?.metrics?.budgetUsage || 0) - (before?.metrics?.budgetUsage || 0),
  p0Improved: !before?.metrics?.p0Pass && after?.metrics?.p0Pass,
});

export const validateBridge = (bridge) => {
  const errors = [];
  if (bridge?.policy !== V65_BRIDGE_POLICY.id) errors.push('policy');
  if (bridge?.manifest?.version !== 65) errors.push('version');
  if (bridge?.manifest?.canonicalExtent?.width !== 9000) errors.push('extent-width');
  if (bridge?.manifest?.canonicalExtent?.depth !== 7000) errors.push('extent-depth');
  const health = bridgeHealth(bridge);
  if (!health.healthy) errors.push(...health.checks.filter((item) => !item.pass).map((item) => `health:${item.id}`));
  return { ok: errors.length === 0, errors };
};

export const freezeTelemetry = (bridge) => Object.freeze({
  policy: V65_BRIDGE_POLICY.id,
  digest: bridge?.digest || digest(bridge),
  health: bridgeHealth(bridge),
  metrics: bridgeMetrics(bridge),
});

export const bridgeScenarioInputs = () => ({
  summerForest: { dayOfYear: 180, biome: 'forest', weather: { mode: 'clear', precipitation: 0.1, humidity: 0.5, temperature: 0.5 } },
  wetlandEdge: { dayOfYear: 122, biome: 'wetland', weather: { mode: 'rain', precipitation: 0.42, humidity: 0.9, temperature: 0.2 } },
  alpineWinter: { dayOfYear: 355, biome: 'alpine', weather: { mode: 'snow', precipitation: 0.55, humidity: 0.85, temperature: -0.7 } },
  coastalStorm: { dayOfYear: 244, biome: 'coastal', weather: { mode: 'storm', precipitation: 0.85, humidity: 0.95, temperature: 0.02 } },
});

export const bridgeReplay = (input, runs = 2) => {
  const results = Array.from({ length: Math.max(1, Math.min(4, runs)) }, () => buildBridgeRuntime(input));
  const first = results[0];
  return { count: results.length, stable: results.every((result) => result.digest === first.digest), digests: results.map((result) => result.digest) };
};

export const boundaryAssertion = (bridge) => ({
  readOnly: bridge?.runtime?.contract?.noWorldMutation === true,
  materialOwner: bridge?.runtime?.contract?.sharedMaterialAuthority === V65_BRIDGE_POLICY.owners.material,
  placementOwner: bridge?.runtime?.contract?.sharedPlacementAuthority === V65_BRIDGE_POLICY.owners.placement,
});

export const bridgeSummary = (bridge) => ({
  manifest: bridge?.manifest?.id,
  policy: bridge?.policy,
  health: bridgeHealth(bridge).healthy,
  metrics: bridgeMetrics(bridge),
  replay: bridgeReplay({ samples: [] }, 2),
  boundaries: boundaryAssertion(bridge),
  digest: bridge?.digest,
});
