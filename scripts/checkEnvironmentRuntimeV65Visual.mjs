import assert from 'node:assert/strict';
import { buildVisualAudit, createCameraEvidence, auditEvidenceSet } from '../src/3d/world/environmentRuntimeVisualAuditV65.js';
import { groundReaction } from '../src/3d/world/environmentRuntimeSurfaceV65.js';
import { buildEnvironmentRuntimeV65, acceptanceMetrics } from '../src/3d/world/environmentRuntimeIntegrationV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); console.log(`ok:${id}`); } catch (error) { failures.push(`${id}:${error?.stack || error}`); } };
const healthy = { geometry: {}, water: {}, atmosphere: { luma: 0.58, visibility: 0.86, mountainReadability: 0.82 }, material: {}, biomeSeparation: 0.88 };

check('camera-catalogue', () => {
  const audit = buildVisualAudit([
    { camera: 'world-full', ...healthy },
    { camera: 'terrain-near', ...healthy },
    { camera: 'far-mountain', ...healthy },
    { camera: 'water-edge', ...healthy },
    { camera: 'biome-ecotone', ...healthy },
  ]);
  assert.equal(audit.results.length, 5);
  assert.equal(audit.p0Pass, true);
  assert.ok(audit.meanScore > 0.8);
});

check('camera-water-moire', () => {
  const audit = buildVisualAudit([{ camera: 'water-edge', ...healthy, water: { moire: true } }]);
  assert.equal(audit.p0Pass, false);
});

check('camera-black-sky', () => {
  const audit = buildVisualAudit([{ camera: 'world-full', ...healthy, atmosphere: { blackSky: true, luma: 0.03 } }]);
  assert.equal(audit.p0Pass, false);
});

check('camera-floating', () => {
  const audit = buildVisualAudit([{ camera: 'terrain-near', ...healthy, geometry: { floating: true } }]);
  assert.equal(audit.p1Pass, false);
});

check('evidence-canonical', () => {
  const evidence = ['world-full', 'terrain-near', 'far-mountain'].map((camera) => createCameraEvidence(camera, { readability: 0.92, grounding: 0.93, biomeSeparation: 0.88, waterClarity: 0.9 }));
  const result = auditEvidenceSet(evidence);
  assert.equal(result.valid, true);
  assert.ok(result.evidenceScore > 0.8);
});

check('evidence-bad-resolution', () => {
  const result = auditEvidenceSet([{ camera: 'bad', projection: 'perspective', width: 800, height: 600, metrics: {} }]);
  assert.equal(result.valid, false);
});

check('surface-water-near-readable', () => {
  const reaction = groundReaction({ elevation: 2, slope: 3, moisture: 0.92, temperature: 0.2, snow: 0, waterDistance: 18 }, { precipitation: 0.25, humidity: 0.82, cloud: 0.4, temperature: 0.16, mode: 'overcast' });
  assert.ok(reaction.wetEdge.foam >= 0);
  assert.ok(reaction.luma >= 0.08);
});

check('integrated-acceptance', () => {
  const samples = Array.from({ length: 12 }, (_, i) => ({ x: i * 64, z: i * 31, elevation: 300 + i * 30, slope: 5, moisture: 0.7, temperature: 0.3, wind: 0.2, snow: 0.02, waterDistance: 320, roadDistance: 30, settlementDistance: 80, confidence: 0.9, biome: 'forest' }));
  const runtime = buildEnvironmentRuntimeV65({ samples, runtimeInput: { seed: 65 }, weather: { precipitation: 0.12, humidity: 0.5, temperature: 0.3, mode: 'overcast' }, platform: 'desktop' });
  const metrics = acceptanceMetrics(runtime);
  assert.ok(metrics.adaptiveAcceptance >= 0.55);
  assert.ok(metrics.continuity >= 0.72);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-visual', checks: 8 }));
