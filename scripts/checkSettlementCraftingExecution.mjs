import assert from 'node:assert/strict';
import { createSettlementCraftingExecution } from '../src/3d/gameplay/settlementCraftingExecution.js';

let calls = 0;
const executor = createSettlementCraftingExecution({
	now: () => 1700000000000,
	executeCraft: (payload) => { calls += 1; return { ok: true, output: { itemId: 'iron-sword', quantity: 1, recipeId: payload.recipeId } }; },
});
const plan = { recipeId: 'iron-sword', stationId: 'blacksmith-1', inventoryFingerprint: 'inv-a', inputs: [{ itemId: 'iron-ingot', quantity: 2 }, { itemId: 'leather', quantity: 1 }] };
const success = executor.execute(plan, { inventoryFingerprint: 'inv-a' });
assert.deepEqual(success, { ok: true, reason: null, recipeId: 'iron-sword', stationId: 'blacksmith-1', output: { itemId: 'iron-sword', quantity: 1, recipeId: 'iron-sword' } });
assert.equal(calls, 1);
assert.equal(executor.execute(plan, { inventoryFingerprint: 'inv-b' }).reason, 'stale-crafting-plan');
assert.equal(calls, 1);
assert.equal(executor.execute({ ...plan, inputs: [] }, { inventoryFingerprint: 'inv-a' }).reason, 'craft-handler-unavailable');
const rejecting = createSettlementCraftingExecution({ executeCraft: () => ({ ok: false, reason: 'missing-ingredient' }) });
assert.equal(rejecting.execute(plan, { inventoryFingerprint: 'inv-a' }).reason, 'missing-ingredient');
const throwing = createSettlementCraftingExecution({ executeCraft: () => { throw new Error('boom'); } });
assert.equal(throwing.execute(plan, { inventoryFingerprint: 'inv-a' }).reason, 'craft-handler-error');
console.log('settlement-crafting-execution: PASS');
