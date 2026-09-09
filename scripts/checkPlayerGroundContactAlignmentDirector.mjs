import assert from 'node:assert/strict';
import { createPlayerGroundContactAlignmentPlan, serializePlayerGroundContactAlignmentPlan } from '../src/3d/gameplay/playerGroundContactAlignmentDirector.js';

const aligned = createPlayerGroundContactAlignmentPlan({ visualY: 10, colliderY: 10, groundY: 10 });
assert.equal(aligned.status, 'aligned');
assert.equal(aligned.requiresTransformWrite, false);

const drift = createPlayerGroundContactAlignmentPlan({ visualY: 10.2, colliderY: 10.02, groundY: 10, toleranceMeters: 0.01 });
assert.equal(drift.status, 'visual-collider-drift');
assert.equal(drift.requiresTransformWrite, true);
assert.ok(drift.correctionMeters < 0);

const blocked = createPlayerGroundContactAlignmentPlan({ visualY: 2, colliderY: 2, groundY: 0, slopeDegrees: 60, slopeLimitDegrees: 45 });
assert.equal(blocked.status, 'slope-blocked');
assert.equal(blocked.valid, false);
assert.equal(blocked.correctionMeters, 0);

const fallback = createPlayerGroundContactAlignmentPlan({ visualY: NaN, colliderY: Infinity, groundY: 0, assetReady: false });
assert.equal(fallback.status, 'asset-not-ready');
assert.equal(Number.isFinite(fallback.visualGroundOffsetMeters), true);
assert.equal(Object.isFrozen(fallback), true);
assert.equal(serializePlayerGroundContactAlignmentPlan(aligned), serializePlayerGroundContactAlignmentPlan(aligned));
console.log('player ground contact alignment checks passed');
