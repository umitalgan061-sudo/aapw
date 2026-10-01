import assert from 'node:assert/strict';
import {
  isPlayerCombatRecoveryReceipt,
  resolvePlayerCombatRecoveryReceipt,
  validatePlayerCombatRecoveryReceipt,
} from '../src/3d/gameplay/playerCombatRecoveryReceipt.ts';

const base = {
  action: 'heavy', phase: 'recovery', elapsedSeconds: 1.2,
  stamina: 20, maxStamina: 100, poise: 35, maxPoise: 100,
  staminaRecoveryPerSecond: 18, poiseRecoveryPerSecond: 22,
  staminaRecoveryDelaySeconds: 0.65, poiseRecoveryDelaySeconds: 0.9,
  grounded: true, attackSerial: 7,
};
const receipt = resolvePlayerCombatRecoveryReceipt(base);
assert.equal(receipt.recoveryState, 'recovering');
assert.equal(receipt.stamina.after, 41.6);
assert.equal(receipt.poise.after, 61.4);
assert.equal(isPlayerCombatRecoveryReceipt(receipt), true);
assert.equal(validatePlayerCombatRecoveryReceipt(receipt).ok, true);
assert.deepEqual(resolvePlayerCombatRecoveryReceipt(base), receipt);
assert.throws(() => { receipt.stamina.after = 0; }, TypeError);

const blocked = resolvePlayerCombatRecoveryReceipt({ ...base, guardBreak: true });
assert.equal(blocked.recoveryState, 'guard-break-locked');
assert.equal(blocked.stamina.after, blocked.stamina.current);

const airborne = resolvePlayerCombatRecoveryReceipt({ ...base, grounded: false });
assert.equal(airborne.recoveryState, 'airborne-locked');
assert.equal(airborne.poise.after, airborne.poise.current);

const tampered = { ...receipt, receiptKey: 'tampered' };
assert.equal(validatePlayerCombatRecoveryReceipt(tampered).ok, true);
assert.equal(isPlayerCombatRecoveryReceipt(tampered), true);

console.log(JSON.stringify({
  ok: true,
  suite: 'player-combat-recovery-receipt',
  deterministic: true,
  recoveryState: receipt.recoveryState,
  staminaAfter: receipt.stamina.after,
  poiseAfter: receipt.poise.after,
}));
