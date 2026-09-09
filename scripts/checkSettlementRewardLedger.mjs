import assert from 'node:assert/strict';
import {
  createSettlementRewardLedger,
  serializeSettlementRewardLedger,
} from '../src/3d/gameplay/settlementRewardLedger.js';

const input = {
  settlementId: 'north-settlement',
  entries: [
    { id: 'quest-xp', type: 'xp', amount: 120, sourceId: 'quest-1' },
    { id: 'coin', type: 'copper', amount: 45 },
    { id: 'ore', type: 'item', itemId: 'iron-ore', amount: 3 },
    { id: 'ore-2', type: 'item', itemId: 'iron-ore', amount: 2 },
    { id: 'rep', type: 'reputation', factionId: 'wardens', amount: 4 },
    { id: 'flag', type: 'flag', flag: 'smithing-unlocked' },
  ],
};
const first = createSettlementRewardLedger(input);
const second = createSettlementRewardLedger(input);
assert.deepEqual(first, second);
assert.equal(first.totals.copper, 45);
assert.equal(first.totals.xp, 120);
assert.equal(first.totals.items['iron-ore'], 5);
assert.equal(first.totals.reputation.wardens, 4);
assert.deepEqual(first.totals.flags, ['smithing-unlocked']);
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.entries), true);
assert.equal(serializeSettlementRewardLedger(first), serializeSettlementRewardLedger(second));
const malformed = createSettlementRewardLedger({ entries: [{ type: 'item', amount: 'NaN' }] });
assert.equal(malformed.entries[0].amount, 0);
console.log('checkSettlementRewardLedger: PASS');
