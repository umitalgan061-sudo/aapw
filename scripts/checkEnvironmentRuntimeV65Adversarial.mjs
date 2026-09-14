import assert from 'node:assert/strict';
import { buildAdaptiveDecision, placementMask, familyAffinity } from '../src/3d/world/environmentRuntimeAdaptiveV65.js';
import { roleWeights, precipitationType, weatherVisibility } from '../src/3d/world/environmentRuntimeSurfaceV65.js';
import { continuityMatrix, buildBoundaryTransfers } from '../src/3d/world/environmentRuntimeContinuityV65.js';
import { buildFrameEnvelope, adaptiveBudget, lodHysteresis } from '../src/3d/world/environmentRuntimeStreamingV65.js';
import { buildPhenologyField, seasonalBlend } from '../src/3d/world/environmentRuntimePhenologyV65.js';
import { environmentSnapshot, querySafety } from '../src/3d/world/environmentRuntimeQueryV65.js';
import { buildVisualAudit } from '../src/3d/world/environmentRuntimeVisualAuditV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); } catch (e) { failures.push(`${id}:${e?.message || e}`); } };
const hostile = { x: -1200, z: 3400, elevation: 2400, slope: 87, moisture: 0.02, temperature: -0.9, wind: 0.98, snow: 1, waterDistance: 0, roadDistance: 0, settlementDistance: 0, confidence: 0.99, biome: 'alpine' };

check('hostile-primary-does-not-crash', () => assert.doesNotThrow(() => buildAdaptiveDecision(hostile)));
check('hostile-grass-reject', () => assert.equal(placementMask(hostile, 'grass').eligible, false));
check('hostile-tree-reject', () => assert.equal(placementMask(hostile, 'conifer').eligible, false));
check('rock-affinity-nonnegative', () => assert.ok(familyAffinity(hostile, 'alpineRock') >= 0));
check('surface-sums', () => {
  const weights = roleWeights(hostile, { precipitation: 1, humidity: 1, temperature: -1, mode: 'storm' });
  assert.ok(Math.abs(Object.values(weights).reduce((a, b) => a + b, 0) - 1) < 0.02);
});
check('visibility-floor', () => assert.ok(weatherVisibility({ precipitation: 1, humidity: 1, cloud: 1, temperature: -1, mode: 'storm' }, 20000) >= 0.06));
check('snow-overrides-rain', () => assert.equal(precipitationType(hostile, { precipitation: 1, temperature: -0.9 }), 'snow'));
check('boundary-crossing-deterministic', () => {
  const a = buildBoundaryTransfers([{ x: 511.8, z: 100, family: 'scree' }], '0:0');
  const b = buildBoundaryTransfers([{ x: 511.8, z: 100, family: 'scree' }], '0:0');
  assert.deepEqual(a, b);
});
check('matrix-symmetric-count', () => {
  const matrix = continuityMatrix({ '0:0': [{ x: 508, z: 90, family: 'grass' }], '1:0': [{ x: 520, z: 90, family: 'grass' }], '0:1': [{ x: 508, z: 520, family: 'grass' }] });
  assert.equal(matrix.pairCount, 2);
});
check('mobile-critical-budget', () => {
  const envelope = buildFrameEnvelope({ platform: 'mobile', metrics: { fps: 12, drawCalls: 260, triangles: 1800000, texturesMb: 900, residentChunks: 9 }, items: [] });
  assert.equal(envelope.pressure, 'critical');
  assert.ok(envelope.budget.triangles < 650000);
});
check('lod-hysteresis-fast-camera', () => {
  assert.equal(lodHysteresis({ previous: 'near', next: 'mid', distance: 700, cameraVelocity: 100 }), 'near');
});
check('seasonal-equality-wrap', () => assert.deepEqual(seasonalBlend(-365), seasonalBlend(0)));
check('phenology-empty', () => assert.equal(buildPhenologyField([]).length, 0));
check('water-query-safe', () => {
  const snapshot = environmentSnapshot({ sample: { ...hostile, water: true } });
  assert.equal(snapshot.ground.safeForTree, false);
  assert.equal(querySafety(snapshot).ok, true);
});
check('visual-p0-seam', () => {
  const audit = buildVisualAudit([{ camera: 'terrain-near', material: { seam: true }, water: {}, geometry: {}, atmosphere: {} }]);
  assert.equal(audit.p0Pass, false);
});
check('visual-placeholder-p1', () => {
  const audit = buildVisualAudit([{ camera: 'terrain-near', material: {}, water: {}, geometry: { placeholders: true }, atmosphere: {} }]);
  assert.equal(audit.p1Pass, false);
});

for (let i = 0; i < 20; i += 1) {
  check(`stress-adaptive-${i}`, () => {
    const sample = { ...hostile, x: i * 37 - 500, z: i * 19, slope: i % 2 ? 12 : 62, moisture: (i % 10) / 10, temperature: -0.9 + (i % 18) / 10, snow: i % 3 === 0 ? 0.8 : 0.1, waterDistance: i * 30, roadDistance: 20, settlementDistance: 50 };
    const result = buildAdaptiveDecision(sample, i);
    assert.ok(result.density.base >= 0.05);
    assert.ok(result.confidence >= 0);
  });
}

if (failures.length) { console.error(JSON.stringify({ ok: false, failures }, null, 2)); process.exitCode = 1; }
else console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-adversarial', checks: 36 }));
