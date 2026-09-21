import assert from 'node:assert/strict';
import { composePlayerCombatFrame, isPlayerCombatFrame } from '../src/3d/gameplay/playerCombatFrameAssembler.ts';

const frame = composePlayerCombatFrame({
  timestamp: 42,
  revision: 7,
  input: { moveX: 2, moveZ: -2, sprint: true, lockOn: true, heavyAttack: true },
  equipment: { mainHand: { id: 'greatsword' }, chest: { id: 'plate' } },
  motion: { state: 'attack-heavy', planarSpeedMps: 3.2, staminaRatio: 0.6, poiseRatio: 0.4 },
  attack: { kind: 'heavy', comboStep: 2, active: true },
  animation: { state: 'attack-heavy', transition: 'attack-enter', attackWeight: 0.9, environmentValid: true },
  outcome: { kind: 'hit', appliedAmount: 12 },
});

assert.equal(frame.input.moveX, 1);
assert.equal(frame.input.moveZ, -1);
assert.equal(frame.combat.attackKind, 'heavy');
assert.equal(frame.combat.weaponId, 'greatsword');
assert.equal(frame.combat.armorId, 'plate');
assert.equal(frame.combat.twoHanded, true);
assert.equal(frame.animation.environmentValid, true);
assert.equal(frame.outcome.kind, 'hit');
assert.equal(isPlayerCombatFrame(frame), true);
assert.throws(() => { frame.input.moveX = 0; }, TypeError);

const fallback = composePlayerCombatFrame();
assert.equal(fallback.combat.attackKind, 'none');
assert.equal(fallback.motion.grounded, true);
assert.equal(fallback.input.moveMagnitude, 0);
assert.equal(isPlayerCombatFrame(fallback), true);

console.log('Player combat frame assembler checks passed.');
