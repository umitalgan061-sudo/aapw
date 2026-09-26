import { strict as assert } from 'node:assert/strict';
import { createPlayerCombatFrameReceipt, validatePlayerCombatFrameReceipt } from '../src/3d/gameplay/playerCombatFrameReceipt.ts';

const playerObject = { name: 'proof-player', children: [], userData: {} };
const input = {
  playerObject,
  equipment: { mainHand: 'iron-sabre', offHand: 'buckler', chest: 'leather-coat', head: 'hood' },
  motion: { state: 'attack-active', isGrounded: true, staminaRatio: 0.72, poiseRatio: 0.81 },
  attack: { kind: 'light', attackPhase: 'active', comboStep: 2, active: true },
  revision: 4,
};
const first = createPlayerCombatFrameReceipt(input);
const second = createPlayerCombatFrameReceipt(input);
assert.deepEqual(first, second);
assert.equal(first.phase, 'active');
assert.equal(first.attackKind, 'light');
assert.equal(first.comboStep, 2);
assert.equal(first.grounded, true);
assert.deepEqual(validatePlayerCombatFrameReceipt(first), {
  ok: true,
  phaseOk: true,
  ratiosOk: true,
  signatureOk: true,
  materialOk: true,
});
assert.throws(() => createPlayerCombatFrameReceipt({}), /requires playerObject/);
assert.equal(Object.isFrozen(first), true);
console.log('player combat frame receipt proof: PASS');
