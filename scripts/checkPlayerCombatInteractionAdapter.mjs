import assert from 'node:assert/strict';
import { resolvePlayerCombatInteractionFrame, validatePlayerCombatInteractionFrame } from '../src/3d/gameplay/playerCombatInteractionAdapter.ts';

const equipment = {
  mainHand: { damageMultiplier: 1.2, reachMultiplier: 1.1, poiseMultiplier: 1.15, projectile: false },
  armor: { staminaDrainMultiplier: 1, dodgeDistanceMultiplier: 1, movementMultiplier: 1, poiseBonus: 0 },
  ranged: false,
  twoHanded: false,
  shieldEquipped: false,
  sourceIds: { head: 'head', chest: 'chest', back: 'back', mainHand: 'sword', offHand: 'none' },
};

const frame = resolvePlayerCombatInteractionFrame({
  equipment,
  attackKind: 'heavy',
  comboStep: 2,
  origin: { x: 0, y: 0, z: 0 },
  facing: { x: 0, z: 1 },
  targets: [
    { id: 'far', position: { x: 0.2, y: 0, z: 1.8 }, priority: 0.1 },
    { id: 'guarded', position: { x: -0.2, y: 0, z: 1.2 }, guard: true, blockedBy: ['heavy'], priority: 0.4 },
    { id: 'behind', position: { x: 0, y: 0, z: -1 }, priority: 1 },
  ],
  staminaRatio: 0.8,
});

assert.equal(frame.attackKind, 'heavy');
assert.equal(frame.comboStep, 2);
assert.equal(frame.intents.length, 2);
assert.equal(frame.intents[0].id, 'guarded');
assert.equal(frame.intents[0].outcome, 'blocked');
assert.equal(frame.intents[0].damage, 0);
assert.equal(frame.intents[1].outcome, 'hit');
assert.ok(frame.intents[1].damage > 0);
assert.equal(validatePlayerCombatInteractionFrame(frame).ok, true);
assert.equal(Object.isFrozen(frame), true);
assert.equal(Object.isFrozen(frame.intents[0]), true);

const repeat = resolvePlayerCombatInteractionFrame({
  equipment,
  attackKind: 'heavy',
  comboStep: 2,
  origin: { x: 0, y: 0, z: 0 },
  facing: { x: 0, z: 1 },
  targets: [
    { id: 'guarded', position: { x: -0.2, y: 0, z: 1.2 }, guard: true, blockedBy: ['heavy'], priority: 0.4 },
    { id: 'far', position: { x: 0.2, y: 0, z: 1.8 }, priority: 0.1 },
  ],
  staminaRatio: 0.8,
});
assert.deepEqual(frame.intents, repeat.intents);
console.log('playerCombatInteractionAdapter: PASS');
