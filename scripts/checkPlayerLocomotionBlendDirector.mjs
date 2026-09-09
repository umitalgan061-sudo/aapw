import assert from 'node:assert/strict';
import { projectLocomotionBlend, stableSerializeLocomotionBlend, LOCOMOTION_STATES } from '../src/3d/gameplay/playerLocomotionBlendDirector.js';

const input = { velocityX: 1, velocityZ: 3, facingRadians: 0.2, grounded: true, maxSpeed: 8.2, transitionSeconds: 0.1 };
const first = projectLocomotionBlend(input);
const second = projectLocomotionBlend(input);
assert.deepEqual(first, second);
assert.equal(first.state, LOCOMOTION_STATES.RUN);
assert.ok(first.speed > 0 && first.speedNorm > 0);
assert.ok(first.forward <= 1 && first.forward >= -1);
assert.ok(first.strafe <= 1 && first.strafe >= -1);
assert.equal(Object.isFrozen(first), true);
assert.equal(stableSerializeLocomotionBlend(input), stableSerializeLocomotionBlend(input));
assert.equal(projectLocomotionBlend({ stunned: true, velocityX: 2, grounded: true }).state, LOCOMOTION_STATES.STUN);
assert.equal(projectLocomotionBlend({ dodging: true, grounded: true }).state, LOCOMOTION_STATES.DODGE);
assert.equal(projectLocomotionBlend({ attacking: true, attackProgress: 0.4, grounded: true }).attackBlend, 0.4);
assert.equal(projectLocomotionBlend({ grounded: false }).state, LOCOMOTION_STATES.AIR);
assert.ok(Number.isFinite(projectLocomotionBlend({ velocityX: 'bad', velocityZ: null }).speed));
console.log('player locomotion blend director contract: ok');
