import assert from 'node:assert/strict';
import { buildSettlementRoleInteractionPlan, serializeSettlementRoleInteractionPlan } from '../src/3d/gameplay/settlementRoleInteractionPlan.js';

const definition = {
  settlementId: 'frostford',
  nodes: [
    { id: 'gate', role: 'gate', label: 'Kapı', actions: ['enter', 'travel', 'back'], capability: 'door' },
    { id: 'smith', role: 'blacksmith', label: 'Demirci', actions: ['craft', 'trade', 'back'], capability: 'crafting' },
    { id: 'house', role: 'house', label: 'Ev', actions: ['save', 'interact'], capability: 'persistence' },
  ],
};

const input = { definition, capabilities: ['door', 'crafting', 'persistence'], insideSettlement: true, health: 100, saveEnabled: false };
const first = buildSettlementRoleInteractionPlan(input);
const second = buildSettlementRoleInteractionPlan(input);
assert.deepEqual(first, second);
assert.equal(first.summary.total, 8);
assert.equal(first.summary.available, 7);
assert.equal(first.rows.find((row) => row.action === 'save').reason, 'save-disabled');
assert.equal(Object.isFrozen(first), true);
assert.equal(Object.isFrozen(first.rows), true);
assert.equal(serializeSettlementRoleInteractionPlan(first), serializeSettlementRoleInteractionPlan(second));

const outside = buildSettlementRoleInteractionPlan({ definition, capabilities: ['door', 'crafting', 'persistence'], insideSettlement: false });
assert.equal(outside.summary.available, 0);
assert.equal(outside.rows.every((row) => row.reason === 'outside-settlement'), true);

const malformed = buildSettlementRoleInteractionPlan({ definition: null, capabilities: null, health: 'bad' });
assert.equal(malformed.summary.total, 0);
assert.equal(malformed.health, 0);
assert.equal(Number.isFinite(Number(malformed.digest)), false);

console.log('settlement role interaction plan: ok');
