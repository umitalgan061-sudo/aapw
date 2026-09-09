import assert from 'node:assert/strict';
import { planSettlementIntentQueue, executeSettlementIntentQueue, serializeSettlementIntentQueue } from '../src/3d/gameplay/settlementIntentQueue.js';
const intents = [
  { id: 'open-market', action: 'interact', input: { nodeId: 'market' } },
  { id: 'trade-1', action: 'trade', dependsOn: 'open-market', input: { itemId: 'travel_rations', quantity: 1 } },
  { id: 'bad', action: 'teleport' },
  { id: 'bad', action: 'talk' },
];
const first = planSettlementIntentQueue(intents);
const second = planSettlementIntentQueue(intents);
assert.deepEqual(first, second);
assert.equal(first.queued, 2);
assert.equal(first.blocked, 2);
assert.equal(Object.isFrozen(first), true);
const calls = [];
const runtime = { execute: async (action, input) => { calls.push({ action, input }); return { ok: action !== 'trade', reason: action === 'trade' ? 'insufficient-copper' : '' }; } };
const executed = await executeSettlementIntentQueue(runtime, intents, { stopOnFailure: false });
assert.equal(executed.results.length, 4);
assert.equal(executed.completed, 1);
assert.equal(executed.failed, 3);
assert.equal(calls.length, 2);
assert.equal(calls[1].input.requestId, 'queue-trade-1');
assert.equal(serializeSettlementIntentQueue(executed), serializeSettlementIntentQueue(executed));
console.log('settlement intent queue checks passed');
