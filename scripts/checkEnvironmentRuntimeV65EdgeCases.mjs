import assert from 'node:assert/strict';
import { buildAdaptiveDecision, placementMask, densityProfile } from '../src/3d/world/environmentRuntimeAdaptiveV65.js';
import { groundReaction, weatherVisibility, precipitationType } from '../src/3d/world/environmentRuntimeSurfaceV65.js';
import { chunkKey, buildBoundaryTransfers, healSeam, continuityMatrix } from '../src/3d/world/environmentRuntimeContinuityV65.js';
import { selectTier, adaptiveBudget, residentChunkPlan } from '../src/3d/world/environmentRuntimeStreamingV65.js';
import { seasonalBlend, leafState, crossFadePhenology } from '../src/3d/world/environmentRuntimePhenologyV65.js';
import { environmentSnapshot, querySafety } from '../src/3d/world/environmentRuntimeQueryV65.js';

const failures = [];
const check = (id, fn) => { try { fn(); console.log(`ok:${id}`); } catch (error) { failures.push(`${id}:${error?.stack || error}`); } };
const base = { x: 512, z: 512, elevation: 300, slope: 10, moisture: 0.5, temperature: 0.2, wind: 0.2, snow: 0, waterDistance: 500, roadDistance: 80, settlementDistance: 200, confidence: 0.9, biome: 'grassland' };

check('bad-confidence-rejects', () => {
  const d = buildAdaptiveDecision({ ...base, confidence: 0.2 });
  assert.equal(d.primaryFamily, null);
});

check('cliff-prefers-geology', () => {
  const d = buildAdaptiveDecision({ ...base, slope: 58, elevation: 1400, biome: 'alpine' });
  assert.ok(d.primaryFamily === 'alpineRock' || d.primaryFamily === 'scree' || d.primaryFamily === null);
});

check('permanent-snow-broadleaf-safe', () => {
  const mask = placementMask({ ...base, snow: 1 }, 'broadleaf');
  assert.equal(mask.eligible, false);
});

check('road-grass-buffer', () => {
  const mask = placementMask({ ...base, roadDistance: 2 }, 'grass');
  assert.equal(mask.eligible, false);
});

check('settlement-tree-buffer', () => {
  const mask = placementMask({ ...base, settlementDistance: 4 }, 'conifer');
  assert.equal(mask.eligible, false);
});

check('wetland-reed-hydrology', () => {
  const near = placementMask({ ...base, waterDistance: 30, moisture: 0.9, biome: 'wetland' }, 'reed');
  const far = placementMask({ ...base, waterDistance: 340, moisture: 0.9, biome: 'wetland' }, 'reed');
  assert.equal(near.eligible, true);
  assert.equal(far.eligible, false);
});

check('density-never-negative', () => {
  const d = densityProfile({ ...base, slope: 90, snow: 1 });
  assert.ok(d.base >= 0.05);
});

check('rain-visibility', () => {
  const a = weatherVisibility({ precipitation: 0, humidity: 0.3, cloud: 0.1, temperature: 0.4, mode: 'clear' }, 0);
  const b = weatherVisibility({ precipitation: 1, humidity: 1, cloud: 1, temperature: 0.2, mode: 'storm' }, 0);
  assert.ok(b < a);
});

check('snow-type', () => {
  assert.equal(precipitationType(base, { precipitation: 0.8, temperature: -0.8 }), 'snow');
});

check('chunk-boundary', () => {
  assert.equal(chunkKey(511, 511), '0:0');
  assert.equal(chunkKey(512, 512), '1:1');
});

check('boundary-transfer', () => {
  const transfers = buildBoundaryTransfers([{ x: 508, z: 120, family: 'grass', scale: 1 }], '0:0');
  assert.equal(transfers.length, 1);
  assert.equal(transfers[0].targetChunk, '1:0');
});

check('seam-heal', () => {
  const result = healSeam({ x: 500, z: 100, family: 'conifer', scale: 0.9 }, { x: 518, z: 101, family: 'conifer', scale: 1.1 });
  assert.equal(result.changed, true);
  assert.equal(result.bridge.family, 'conifer');
});

check('family-mismatch-no-heal', () => {
  const result = healSeam({ x: 500, z: 100, family: 'grass' }, { x: 518, z: 101, family: 'conifer' });
  assert.equal(result.changed, false);
});

check('continuity-no-duplicate', () => {
  const matrix = continuityMatrix({
    '0:0': [{ x: 500, z: 100, family: 'grass' }, { x: 500, z: 100, family: 'grass' }],
    '1:0': [{ x: 520, z: 100, family: 'grass' }],
  });
  assert.equal(matrix.pairCount, 1);
});

check('tier-critical-near', () => {
  assert.equal(selectTier({ distance: 200, importance: 0.1, gameplayCritical: true }, {}), 'near');
});

check('tier-impostor-far', () => {
  assert.equal(selectTier({ distance: 8000, importance: 0.1, projectedSize: 0.01 }, {}), 'impostor');
});

check('budget-critical', () => {
  const b = adaptiveBudget({ platform: 'mobile', metrics: { fps: 10, drawCalls: 400, triangles: 2000000, texturesMb: 1000, residentChunks: 8 } });
  assert.equal(b.pressure, 'critical');
  assert.ok(b.factor < 1);
});

check('resident-limit', () => {
  const chunks = Array.from({ length: 20 }, (_, i) => ({ key: `${i}:0`, x: i * 300, z: 0, importance: i === 0 ? 1 : 0.2, continuity: 0.8 }));
  const selected = residentChunkPlan({ center: { x: 0, z: 0 }, chunks, platform: 'mobile' });
  assert.ok(selected.length <= 5);
});

check('season-wrap', () => {
  const a = seasonalBlend(0);
  const b = seasonalBlend(365);
  assert.deepEqual(a, b);
});

check('leaf-winter', () => {
  const state = leafState({ biome: 'forest', temperature: -0.4, moisture: 0.5, dayOfYear: 350 });
  assert.ok(state.bare > state.green || state.frost > 0);
});

check('phenology-crossfade', () => {
  const mid = crossFadePhenology({ green: 1 }, { bare: 1 }, 0.5);
  assert.equal(mid.green, 0.5);
  assert.equal(mid.bare, 0.5);
});

check('water-query-unsafe-tree', () => {
  const snapshot = environmentSnapshot({ sample: { ...base, water: true, waterDistance: 0 } });
  assert.equal(snapshot.placement.eligible, false);
  assert.equal(querySafety(snapshot).ok, true);
});

check('steep-query-navigation', () => {
  const snapshot = environmentSnapshot({ sample: { ...base, slope: 42 } });
  assert.equal(snapshot.navigation.navigable, false);
});

if (failures.length) {
  console.error(JSON.stringify({ ok: false, failures }, null, 2));
  process.exitCode = 1;
} else {
  console.log(JSON.stringify({ ok: true, suite: 'environment-runtime-v65-edge', checks: 22 }));
}
