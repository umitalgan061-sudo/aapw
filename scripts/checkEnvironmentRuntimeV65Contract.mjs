import assert from 'node:assert/strict';
import { buildEnvironmentRuntimeV65, validateIntegratedRuntime, createAcceptanceProfileV65, acceptanceMetrics, qualifiesAcceptance, immutableContractSnapshot } from '../src/3d/world/environmentRuntimeIntegrationV65.js';
import { V65_ADAPTIVE_POLICY } from '../src/3d/world/environmentRuntimeAdaptiveV65.js';
import { V65_SURFACE_POLICY } from '../src/3d/world/environmentRuntimeSurfaceV65.js';
import { V65_CONTINUITY_POLICY } from '../src/3d/world/environmentRuntimeContinuityV65.js';
import { V65_STREAMING_POLICY } from '../src/3d/world/environmentRuntimeStreamingV65.js';
import { V65_PHENOLOGY_POLICY } from '../src/3d/world/environmentRuntimePhenologyV65.js';
import { V65_QUERY_POLICY } from '../src/3d/world/environmentRuntimeQueryV65.js';
import { V65_OBSERVABILITY_POLICY } from '../src/3d/world/environmentRuntimeObservabilityV65.js';
import { V65_VISUAL_AUDIT_POLICY } from '../src/3d/world/environmentRuntimeVisualAuditV65.js';
import { buildVisualAudit, validateVisualAudit, auditEvidenceSet, createCameraEvidence } from '../src/3d/world/environmentRuntimeVisualAuditV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); console.log(`ok:${id}`); } catch (error) { failures.push(`${id}:${error?.stack || error}`); } };
const samples = Array.from({ length: 16 }, (_, i) => ({ x: i * 90, z: i * 40, elevation: 120 + i * 70, slope: 6 + (i % 5) * 4, moisture: 0.35 + (i % 4) * 0.12, temperature: 0.5 - (i % 6) * 0.11, wind: 0.18 + (i % 3) * 0.1, snow: i > 12 ? 0.45 : 0.03, waterDistance: 90 + i * 35, roadDistance: 24 + i * 3, settlementDistance: 90 + i * 8, confidence: 0.86, biome: i > 11 ? 'taiga' : 'forest' }));

check('policy-identities', () => {
  for (const policy of [V65_ADAPTIVE_POLICY, V65_SURFACE_POLICY, V65_CONTINUITY_POLICY, V65_STREAMING_POLICY, V65_PHENOLOGY_POLICY, V65_QUERY_POLICY, V65_OBSERVABILITY_POLICY, V65_VISUAL_AUDIT_POLICY]) assert.match(policy.id, /v65|V65|65/);
});

check('runtime-valid', () => {
  const runtime = buildEnvironmentRuntimeV65({ samples, runtimeInput: { seed: 65, region: 'north' }, weather: { precipitation: 0.15, humidity: 0.55, cloud: 0.25, temperature: 0.26, mode: 'overcast' }, dayOfYear: 210, platform: 'desktop', camera: { x: 240, z: 120 }, chunks: {} });
  const validation = validateIntegratedRuntime(runtime);
  assert.equal(validation.ok, true, validation.errors.join(','));
  const metrics = acceptanceMetrics(runtime);
  assert.ok(metrics.adaptiveAcceptance >= 0.55);
});

check('runtime-deterministic', () => {
  const input = { samples, runtimeInput: { seed: 99 }, weather: { precipitation: 0.2, humidity: 0.6, temperature: 0.1 }, dayOfYear: 164, platform: 'desktop' };
  const a = buildEnvironmentRuntimeV65(input);
  const b = buildEnvironmentRuntimeV65(input);
  assert.deepEqual(a.adaptive.decisions, b.adaptive.decisions);
  assert.deepEqual(a.query.digest, b.query.digest);
  assert.deepEqual(a.report.digest, b.report.digest);
});

check('read-only-contract', () => {
  const runtime = buildEnvironmentRuntimeV65({ samples, runtimeInput: { seed: 1 } });
  const snapshot = immutableContractSnapshot(runtime);
  assert.equal(snapshot.noWorldMutation, true);
  assert.equal(snapshot.placementAuthority, 'WorldAssetPlacementPipeline.js');
  assert.equal(snapshot.materialAuthority, 'MaterialAssignmentCore.js');
});

check('acceptance-profile', () => {
  const profile = createAcceptanceProfileV65();
  assert.equal(profile.width, 1536);
  assert.equal(profile.height, 1024);
  assert.equal(profile.projection, 'orthographic');
  assert.equal(profile.fullWorld, true);
  assert.equal(profile.terrainNear, true);
});

check('visual-audit-clean', () => {
  const audit = buildVisualAudit([
    { camera: 'world-full', geometry: {}, water: {}, atmosphere: { luma: 0.6, visibility: 0.9 }, material: {}, biomeSeparation: 0.9 },
    { camera: 'terrain-near', geometry: {}, water: {}, atmosphere: { luma: 0.5, visibility: 0.92 }, material: {}, biomeSeparation: 0.85 },
  ]);
  assert.equal(validateVisualAudit(audit).ok, true);
  assert.equal(audit.p0Pass, true);
});

check('visual-audit-catches-water', () => {
  const audit = buildVisualAudit([{ camera: 'water-edge', water: { moire: true }, geometry: {}, atmosphere: {}, material: {} }]);
  assert.equal(audit.p0Pass, false);
  assert.ok(audit.results[0].score < 1);
});

check('evidence-shape', () => {
  const evidence = ['world-full', 'terrain-near', 'far-mountain'].map((camera) => createCameraEvidence(camera, { readability: 0.9, grounding: 0.88, biomeSeparation: 0.87, waterClarity: 0.9 }));
  const result = auditEvidenceSet(evidence);
  assert.equal(result.valid, true);
  assert.equal(result.count, 3);
  assert.ok(result.evidenceScore > 0.8);
});

check('acceptance-qualifies', () => {
  assert.equal(qualifiesAcceptance({ adaptiveAcceptance: 0.76, visibility: 0.84, continuity: 0.9, budgetUsage: 0.82, p0Pass: true }), true);
  assert.equal(qualifiesAcceptance({ adaptiveAcceptance: 0.4, visibility: 0.84, continuity: 0.9, budgetUsage: 0.82, p0Pass: true }), false);
});

check('acceptance-rejects-budget', () => {
  assert.equal(qualifiesAcceptance({ adaptiveAcceptance: 0.9, visibility: 0.9, continuity: 0.9, budgetUsage: 1.2, p0Pass: true }), false);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-contract', checks: 10 }));
}
