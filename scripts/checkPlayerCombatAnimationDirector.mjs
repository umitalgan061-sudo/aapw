import assert from 'node:assert/strict';
import { createPlayerCombatAnimationDirector, pickLockOnTarget } from '../src/3d/gameplay/playerCombatAnimationDirector.js';

const player = {
  movementState: 'attack-heavy',
  stamina: 64,
  maxStamina: 100,
  poise: 88,
  maxPoise: 100,
  getMotionState() { return { movementState: this.movementState, stamina: this.stamina, poise: this.poise }; },
};

const targets = [
  { id: 'far', position: { x: 9, z: 0 }, hostile: true },
  { id: 'near', position: { x: 4, z: 0 }, hostile: true },
  { id: 'friendly', position: { x: 1, z: 0 }, hostile: false },
];

assert.equal(pickLockOnTarget(targets, 18).id, 'near');
assert.equal(pickLockOnTarget([{ id: 'bad', position: { x: NaN, z: 0 } }]), null);

const director = createPlayerCombatAnimationDirector({
  player,
  equipment: { weapon: { id: 'viking-sword', kind: 'melee', damage: 42, reachMeters: 2.1, socket: 'mixamorigRightHand' }, armor: { id: 'chain', poise: 18, staminaMultiplier: 0.9 } },
});

const first = director.snapshot({ channel: 'touch', action: 'interact', pressed: true }, targets);
assert.equal(first.input.channel, 'touch');
assert.equal(first.target.id, 'near');
assert.equal(first.animation.layer, 'attack');
assert.equal(first.animation.clip, 'idle');
assert.equal(first.equipment.weapon.socket, 'mixamorigRightHand');
assert.equal(first.feedback.some((cue) => cue.cue === 'attack-trail'), true);
assert.equal(Object.isFrozen(first), true);
assert.equal(first.fingerprint, director.snapshot({ channel: 'touch', action: 'interact', pressed: true }, targets).fingerprint);

director.advance();
assert.equal(director.snapshot({ channel: 'gamepad', action: 'guard', held: true }, targets).input.channel, 'gamepad');
director.dispose();
assert.equal(director.snapshot({ action: 'light', pressed: true }).disposed, true);
console.log('PLAYER_COMBAT_ANIMATION_DIRECTOR_OK');
