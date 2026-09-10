import assert from 'node:assert/strict';
import {
  ENVIRONMENT_STREAMING_BUDGET_V48 as C,
  normalizeChunkObservation,
  planChunkObservation,
  buildStreamingPlan,
  serializeStreamingPlan,
} from '../src/3d/world/environmentStreamingBudgetV48.js';

const near = { id: 'forest-near', distanceMeters: 20, screenCoverage: 0.8, importance: 0.9, biome: 'temperate-forest', readiness: 'ready', instanceCount: 900, activeCamera: true };
const far = { id: 'ridge-far', distanceMeters: 220, screenCoverage: 0.08, importance: 0.7, biome: 'alpine-ridge', readiness: 'ready', instanceCount: 60 };
const missing = { id: 'missing', distanceMeters: 40, screenCoverage: 0.4, biome: 'forest', readiness: 'missing', instanceCount: 30 };

assert.equal(normalizeChunkObservation(near).id, 'forest-near');
assert.equal(planChunkObservation(near).lod, 'near');
assert.equal(planChunkObservation(far).lod, 'far');
assert.ok(planChunkObservation(missing).cullingReasons.includes('asset-not-ready'));

const planA = buildStreamingPlan([near, far, missing]);
const planB = buildStreamingPlan([{ ...near }, { ...far }, { ...missing }]);
assert.deepEqual(planA, planB);
assert.equal(planA.summary.total, 3);
assert.equal(planA.summary.visible, 2);
assert.equal(planA.summary.culled, 1);
assert.ok(planA.summary.instanced >= 2);
assert.equal(serializeStreamingPlan(planA), serializeStreamingPlan(planB));
assert.equal(Object.isFrozen(planA), true);
assert.equal(Object.isFrozen(planA.entries), true);
assert.equal(C.maxVisibleChunks, 64);
console.info(`[environment-streaming] PASS ${C.id}`);
