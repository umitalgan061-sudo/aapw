import assert from 'node:assert/strict';
import { resolvePlayerCombatActionBuffer, serializePlayerCombatActionBuffer } from '../src/3d/gameplay/playerCombatActionBuffer.js';

const sample = { entries: [
  { action: 'light', timestampMs: 1000, sequence: 2 },
  { action: 'dodge', timestampMs: 1120, sequence: 3 },
  { action: 'unknown', timestampMs: 1140, sequence: 4 },
  { action: 'heavy', timestampMs: 700, sequence: 1 },
] };
const first = resolvePlayerCombatActionBuffer(sample, { nowMs: 1200, activeAction: 'light', busy: true });
const second = resolvePlayerCombatActionBuffer(sample, { nowMs: 1200, activeAction: 'light', busy: true });
assert.deepEqual(first, second);
assert.equal(first.nextAction, 'dodge');
assert.equal(first.rejected.some((row) => row.reason === 'unsupported-action'), true);
assert.equal(first.entries.some((row) => row.action === 'heavy'), false);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.entries), true);
assert.equal(serializePlayerCombatActionBuffer(first), serializePlayerCombatActionBuffer(second));

const airborne = resolvePlayerCombatActionBuffer({ entries: [{ action: 'dodge', timestampMs: 50 }] }, { nowMs: 100, grounded: false });
assert.equal(airborne.nextAction, null);
assert.equal(airborne.rejected[0].reason, 'airborne');

const stunned = resolvePlayerCombatActionBuffer({ entries: [{ action: 'parry', timestampMs: 100 }] }, { nowMs: 100, stunned: true });
assert.equal(stunned.canConsume, false);
assert.equal(stunned.consumeReason, 'stunned');

const malformed = resolvePlayerCombatActionBuffer({ entries: [{ action: 'light', timestampMs: 'nope' }] }, { nowMs: 'nope', bufferWindowMs: 'nope', maxEntries: 'nope', staminaRatio: 'nope' });
assert.equal(Number.isFinite(malformed.nowMs), true);
assert.equal(Number.isFinite(malformed.bufferWindowMs), true);
assert.equal(malformed.capacity >= 1, true);

console.log('player combat action buffer checks passed');
