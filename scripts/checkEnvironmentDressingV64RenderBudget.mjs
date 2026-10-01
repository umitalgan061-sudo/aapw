import assert from 'node:assert/strict';
import {
  createV64RenderBudget,
  createV64VisualColliderParity,
  createV64StreamingEnvelope,
  V64_RENDER_BUDGET,
} from '../src/3d/world/environmentRenderBudgetV64.js';
import {
  createEnvironmentDressingAssetHandoffV64,
  validateEnvironmentDressingAssetHandoffV64,
} from '../src/3d/world/environmentDressingAssetHandoffV64.js';

function testBudgetPass() {
  const budget = createV64RenderBudget({ fps: 58, drawCalls: 100, triangles: 900000, textureMemoryMb: 700, mobile: false, cameraDistance: 600 });
  assert.equal(budget.overBudget, false);
  assert.equal(budget.recommendation.reduceLOD, false);
  assert.equal(budget.recommendation.keepNearDetail, false);
}

function testBudgetFail() {
  const budget = createV64RenderBudget({ fps: 28, drawCalls: 140, triangles: 900000, textureMemoryMb: 800, mobile: true, cameraDistance: 150 });
  assert.equal(budget.overBudget, true);
  assert.ok(budget.issues.includes('fps-floor'));
  assert.ok(budget.issues.includes('draw-calls'));
  assert.equal(budget.recommendation.reduceLOD, true);
  assert.equal(budget.recommendation.mergeInstances, true);
  assert.equal(budget.recommendation.keepNearDetail, true);
  assert.ok(V64_RENDER_BUDGET.mobile.fpsFloor > 0);
}

function testParity() {
  const pass = createV64VisualColliderParity({
    terrain: { x: 40, z: 60, canonicalHeight: 100 },
    renderedY: 100.08,
    colliderY: 100.04,
  });
  assert.equal(pass.pass, true);
  const fail = createV64VisualColliderParity({
    terrain: { x: 40, z: 60, canonicalHeight: 100 },
    renderedY: 100.8,
    colliderY: 100.7,
  });
  assert.equal(fail.pass, false);
  assert.ok(fail.renderDelta > pass.renderDelta);
}

function testStreaming() {
  const near = createV64StreamingEnvelope({ cameraDistance: 120, desiredObjects: 900, mobile: false });
  const far = createV64StreamingEnvelope({ cameraDistance: 5200, desiredObjects: 900, mobile: false });
  assert.equal(near.tier, 'near');
  assert.equal(far.tier, 'impostor');
  assert.ok(far.visible < near.visible);
  assert.ok(far.culled > near.culled);
}

function testHandoffBoundary() {
  const handoff = createEnvironmentDressingAssetHandoffV64({
    anchor: { x: 10, z: 20, id: 'budget-boundary' },
    context: {
      biome: 'temperate', moisture: 0.5, slopeDegrees: 10,
      elevationMeters: 300, waterDepth: 0, shorelineDistanceMeters: 500,
      roadDistanceMeters: 50, settlementDistanceMeters: 100, localRelief: 0.5,
      isWater: false,
    },
    seed: 'boundary',
  });
  assert.equal(validateEnvironmentDressingAssetHandoffV64(handoff).valid, true);
  for (const item of handoff.accepted) {
    assert.equal(item.editorRuntimeImported, false);
    assert.equal(item.geometryCreated, false);
  }
}

testBudgetPass();
testBudgetFail();
testParity();
testStreaming();
testHandoffBoundary();
console.log(JSON.stringify({ ok: true, tests: 5 }, null, 2));
