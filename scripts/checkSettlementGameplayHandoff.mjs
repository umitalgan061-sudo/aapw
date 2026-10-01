import assert from 'node:assert/strict';
import {
  createSettlementGameplayHandoff,
  summarizeSettlementGameplayHandoff,
} from '../src/3d/gameplay/settlementGameplayHandoff.js';

const calls = [];
const handoff = createSettlementGameplayHandoff({
  plan: {
    settlementId: 'winterfell-harbor',
    steps: [
      { action: 'enter', nodeId: 'gate', gates: [{ type: 'proximity', distance: 5 }] },
      { action: 'talk', nodeId: 'tavern-keeper', gates: [{ type: 'capability', capability: 'dialogue' }] },
      { action: 'trade', nodeId: 'market-stall', gates: [{ type: 'item', itemId: 'coin', quantity: 2 }] },
      { action: 'craft', nodeId: 'forge', gates: [{ type: 'flag', key: 'smith-open' }] },
    ],
  },
  context: {
    distance: 3,
    items: { coin: 3 },
    flags: { 'smith-open': true },
    capabilities: { dialogue: true },
  },
  slice: {
    execute(payload) {
      calls.push(payload);
      return { ok: true };
    },
  },
});

assert.equal(handoff.status().closed, false);
const firstRun = handoff.runAll();
assert.equal(firstRun.length, 4);
assert.equal(calls.length, 4);
assert.deepEqual(firstRun.map((entry) => entry.ok), [true, true, true, true]);
assert.deepEqual(summarizeSettlementGameplayHandoff(handoff), {
  completed: 4,
  rejected: 0,
  total: 4,
  lastSequence: 4,
});

handoff.close();
const closedResult = handoff.runStep({ action: 'enter', nodeId: 'late' }, 0);
assert.equal(closedResult.ok, false);
assert.equal(closedResult.reason, 'session-closed');

handoff.reset();
const rejected = createSettlementGameplayHandoff({
  plan: { steps: [{ action: 'trade', nodeId: 'market', gates: [{ type: 'item', itemId: 'coin', quantity: 5 }] }] },
  context: { items: { coin: 1 } },
  slice: { execute() { throw new Error('must not execute'); } },
});
assert.equal(rejected.runAll()[0].reason, 'item-required');
assert.deepEqual(summarizeSettlementGameplayHandoff(rejected), {
  completed: 0,
  rejected: 1,
  total: 1,
  lastSequence: 1,
});

const malformed = createSettlementGameplayHandoff({ plan: { steps: [null, { action: 'talk' }] }, slice: { execute() { return true; } } });
assert.equal(malformed.runAll().length, 2);
assert.equal(malformed.receipts()[0].nodeId, 'step-1');
console.log('Settlement gameplay handoff contract: PASS');
