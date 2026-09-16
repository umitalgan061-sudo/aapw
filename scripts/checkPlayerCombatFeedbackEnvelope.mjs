import assert from 'node:assert/strict';
import { createPlayerCombatFeedbackEnvelope, validatePlayerCombatFeedbackReceipt } from '../src/3d/gameplay/playerCombatFeedbackEnvelope.js';

const first = createPlayerCombatFeedbackEnvelope({ historyLimit: 2 });
const second = createPlayerCombatFeedbackEnvelope({ historyLimit: 2 });
const inputs = [
  { outcome: 'hit', impact: 0.8, appliedDamage: 12, targetId: 'enemy-1' },
  { outcome: 'guard-break', impact: 1.5, appliedDamage: 0, critical: true, targetId: 'enemy-1' },
  { outcome: 'defeat', impact: 1, appliedDamage: 99, targetId: 'enemy-1' },
];
const firstReceipts = inputs.map((input) => first.emit(input));
const secondReceipts = inputs.map((input) => second.emit(input));

assert.deepEqual(firstReceipts, secondReceipts, 'same combat feedback inputs must be deterministic');
assert.equal(firstReceipts[1].impact, 1, 'impact must be bounded');
assert.equal(first.snapshot().history.length, 2, 'history must remain bounded');
assert.ok(firstReceipts.every(validatePlayerCombatFeedbackReceipt), 'all receipts must validate');
assert.equal(Object.isFrozen(firstReceipts[0]), true, 'receipt must be immutable');
assert.equal(Object.isFrozen(firstReceipts[0].haptics), true, 'haptic profile must be immutable');

first.dispose();
assert.equal(first.emit({ outcome: 'hit', impact: 1 }), null, 'disposed envelope must fail closed');
assert.equal(first.snapshot().disposed, true, 'dispose state must be observable');

console.log('[checkPlayerCombatFeedbackEnvelope] PASS');
