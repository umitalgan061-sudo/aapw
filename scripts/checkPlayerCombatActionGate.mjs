import assert from 'node:assert/strict';
import { resolvePlayerCombatActionGate, isPlayerCombatActionGate } from '../src/3d/gameplay/playerCombatActionGate.ts';

const base = {
  mainHand: 'sword',
  offHand: 'shield',
  chest: 'mail',
  head: 'helm',
};

const allowed = resolvePlayerCombatActionGate(base, {
  requestedAction: 'heavy',
  staminaRatio: 1,
  poiseRatio: 1,
  grounded: true,
});
assert.equal(isPlayerCombatActionGate(allowed), true);
assert.equal(allowed.selected.allowed, true);
assert.equal(allowed.selected.reason, 'allowed');
assert.equal(Object.isFrozen(allowed), true);
assert.equal(Object.isFrozen(allowed.admissions.heavy), true);

const airborne = resolvePlayerCombatActionGate(base, {
  requestedAction: 'light',
  grounded: false,
});
assert.equal(airborne.selected.allowed, false);
assert.equal(airborne.selected.reason, 'airborne');

const lowStamina = resolvePlayerCombatActionGate(base, {
  requestedAction: 'dodge',
  staminaRatio: 0.1,
  grounded: true,
});
assert.equal(lowStamina.selected.allowed, false);
assert.equal(lowStamina.selected.reason, 'stamina-low');

const parry = resolvePlayerCombatActionGate(base, {
  requestedAction: 'parry',
  staminaRatio: 1,
  grounded: true,
  parryWindowOpen: true,
});
assert.equal(parry.selected.allowed, true);

const replayA = resolvePlayerCombatActionGate(base, {
  requestedAction: 'lockOn',
  targetDistanceMeters: 4,
  targetAngleRad: 0.2,
  targetAlive: true,
  targetVisible: true,
  targetPriority: 0.7,
});
const replayB = resolvePlayerCombatActionGate(base, {
  requestedAction: 'lockOn',
  targetDistanceMeters: 4,
  targetAngleRad: 0.2,
  targetAlive: true,
  targetVisible: true,
  targetPriority: 0.7,
});
assert.deepEqual(replayA, replayB);

const tampered = { ...allowed, selected: { ...allowed.selected, reason: 'tampered' } };
assert.equal(isPlayerCombatActionGate(tampered), true);
assert.notEqual(tampered.gateKey, allowed.gateKey);

const malformed = new Proxy({}, { get() { throw new Error('revoked'); } });
assert.equal(isPlayerCombatActionGate(malformed), false);

console.log('[checkPlayerCombatActionGate] PASS deterministic admission, fail-closed reasons, deep freeze, replay identity, and hostile-shape guard');
