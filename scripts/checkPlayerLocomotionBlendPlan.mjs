import assert from 'node:assert/strict';
import {
  createPlayerLocomotionBlendPlan,
  validatePlayerLocomotionBlendPlan,
} from '../src/3d/gameplay/playerLocomotionBlendPlan.js';

const profile = {
  mainHand: { animationFamily: 'greatsword' },
  armor: { animationFamily: 'heavy' },
};
const animationPlan = { family: 'greatsword', action: 'heavy', clip: 'idle' };

const first = createPlayerLocomotionBlendPlan(profile, {
  animationPlan,
  movementState: 'run',
  attackState: 'heavy',
  attackKind: 'heavy',
  comboStep: 2,
  speedMps: 4.4,
  maxSpeedMps: 5.2,
  grounded: true,
  turnRate: 90,
});
const second = createPlayerLocomotionBlendPlan(profile, {
  animationPlan,
  movementState: 'run',
  attackState: 'heavy',
  attackKind: 'heavy',
  comboStep: 2,
  speedMps: 4.4,
  maxSpeedMps: 5.2,
  grounded: true,
  turnRate: 90,
});

assert.deepEqual(first, second);
assert.equal(validatePlayerLocomotionBlendPlan(first), true);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.layers), true);
assert.equal(first.combat.weights.heavy > 0, true);
assert.equal(first.layers.upperBody > 0.5, true);
assert.equal(first.layers.lowerBody < 1, true);
assert.equal(first.transition.interruptible, false);

const airborne = createPlayerLocomotionBlendPlan(profile, {
  movementState: 'airborne',
  attackKind: 'none',
  speedMps: 2,
  grounded: false,
});
assert.equal(airborne.movement.grounded, false);
assert.equal(airborne.movement.weights.airborne, 1);
assert.equal(airborne.combat.active, 0);
assert.equal(validatePlayerLocomotionBlendPlan(airborne), true);

const invalid = { ...first, schema: 'other' };
assert.equal(validatePlayerLocomotionBlendPlan(invalid), false);

console.log('checkPlayerLocomotionBlendPlan: PASS');
