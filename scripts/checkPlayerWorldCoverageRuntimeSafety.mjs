import assert from 'node:assert/strict';

import {
  PLAYER_WORLD_COVERAGE_ERROR_EVENT,
  createPlayerWorldCoverageRuntimeAdapter,
} from '../src/3d/gameplay/playerWorldCoverageRuntimeAdapter.js';
import {
  createPlayerWorldCoverageRuntimeSafety,
  validatePlayerWorldCoverageRuntimeSafety,
} from '../src/3d/gameplay/playerWorldCoverageRuntimeSafety.js';

const samples = [{
  id: 'forest',
  position: { x: 0, y: 2, z: 0 },
  groundY: 2,
  colliderY: 2,
  canonicalY: 2,
  surface: 'grass',
  biome: 'forest',
  slopeDegrees: 4,
  elevationMeters: 120,
  moisture: 0.3,
  waterCoverage: 0,
  waterDepthMeters: 0,
  assetReady: true,
  visible: true,
  confidence: 1,
}];

const eventTarget = new EventTarget();
eventTarget.CustomEvent = globalThis.CustomEvent;
const errors = [];
eventTarget.addEventListener(PLAYER_WORLD_COVERAGE_ERROR_EVENT, (event) => errors.push(event.detail));

const adapter = createPlayerWorldCoverageRuntimeAdapter({
  player: { object3D: { position: { x: 0, y: 2, z: 0 } }, getState: () => ({ isGrounded: true }) },
  world: { sample: () => samples },
  eventTarget,
  now: () => 4,
});
const safety = createPlayerWorldCoverageRuntimeSafety({ adapter, eventTarget });
assert.equal(validatePlayerWorldCoverageRuntimeSafety(safety).ok, true);
assert.equal(safety.safeUpdate({ forcePublish: true }).ok, true);
assert.equal(safety.safeFocus([]).ok, true);

adapter.dispose();
const failedUpdate = safety.safeUpdate();
assert.equal(failedUpdate.ok, false);
assert.match(failedUpdate.message, /disposed/);
assert.equal(errors.length, 1);
assert.equal(errors[0].phase, 'update');
assert.equal(Object.isFrozen(failedUpdate), true);

const failedFocus = safety.safeFocus([]);
assert.equal(failedFocus.ok, false);
assert.equal(failedFocus.phase, 'focus');
assert.equal(errors.length, 2);

console.log(JSON.stringify({ ok: true, checks: 10, errorEvents: errors.length }));
