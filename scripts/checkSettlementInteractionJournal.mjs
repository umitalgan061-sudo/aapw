import assert from 'node:assert/strict';
import {
  buildSettlementInteractionJournal,
  serializeSettlementInteractionJournal,
  settlementInteractionJournalIsEmpty,
  validateSettlementInteractionJournal,
} from '../src/3d/gameplay/settlementInteractionJournal.js';

const events = [
  { sequence: 2, action: 'trade', ok: true, nodeId: 'market', rewardCopper: -12 },
  { sequence: 1, action: 'enter', ok: true, nodeId: 'gate' },
  { sequence: 3, action: 'craft', ok: false, reason: 'missing-material', nodeId: 'blacksmith' },
  { sequence: 2, action: 'trade', ok: true, nodeId: 'market', rewardCopper: -12 },
];
const first = buildSettlementInteractionJournal({ events });
const second = buildSettlementInteractionJournal({ events: [...events].reverse() });
assert.deepEqual(first, second);
assert.equal(first.entries.length, 3);
assert.equal(first.summary.lastAction, 'craft');
assert.equal(first.summary.failedCount, 1);
assert.equal(first.summary.rewardCopper, -12);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.entries), true);
assert.equal(serializeSettlementInteractionJournal(first), serializeSettlementInteractionJournal(second));
assert.equal(validateSettlementInteractionJournal(first).ok, true);
assert.equal(settlementInteractionJournalIsEmpty({ entries: [] }), true);
assert.equal(buildSettlementInteractionJournal({ events: null }).summary.entryCount, 0);
assert.equal(buildSettlementInteractionJournal({ events: [{ sequence: 'bad', action: 'x', rewardXp: Infinity }] }).entries[0].sequence, 0);
console.log('settlement interaction journal checks passed');
