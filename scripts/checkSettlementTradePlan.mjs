import assert from 'node:assert/strict';
import { buildSettlementTradePlan, isSettlementTradePlan } from '../src/3d/gameplay/settlementTradePlan.ts';

let checks = 0;
const ok = (value, message) => { assert.ok(value, message); checks += 1; };
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };

const inventory = { iron_ore: 4 };
const stock = { iron_ore: 10 };
const request = { serviceId: 'market', serviceOpen: true, direction: 'buy', itemId: 'iron_ore', quantity: 2, copper: 20, inventory, stock };
const first = buildSettlementTradePlan(request);
const second = buildSettlementTradePlan({ ...request, stock: { iron_ore: 10 }, inventory: { iron_ore: 4 } });

eq(first.ok, true, 'buy plan should be executable');
eq(first.total, 12, 'buy total should use the existing item authority');
eq(first.copperDelta, -12, 'buy should debit copper');
eq(first.inventoryDelta.iron_ore, 2, 'buy should add inventory');
eq(first.stockDelta.iron_ore, -2, 'buy should reduce vendor stock');
eq(first.signature, second.signature, 'same inputs should replay deterministically');
ok(isSettlementTradePlan(first), 'plan should pass its frozen shape guard');
ok(Object.isFrozen(first), 'plan should be frozen');
ok(Object.isFrozen(first.inventoryDelta), 'inventory delta should be frozen');
eq(inventory.iron_ore, 4, 'caller inventory must not mutate');
eq(stock.iron_ore, 10, 'caller stock must not mutate');

eq(buildSettlementTradePlan({ ...request, copper: 1 }).reason, 'insufficient-copper', 'buy gate should fail closed');
eq(buildSettlementTradePlan({ ...request, stock: 1 }).reason, 'insufficient-stock', 'stock gate should fail closed');
eq(buildSettlementTradePlan({ ...request, inventory: { iron_ore: 1 }, direction: 'sell', quantity: 2 }).reason, 'missing-item', 'sell gate should fail closed');
eq(buildSettlementTradePlan({ ...request, serviceOpen: false }).reason, 'service-closed', 'closed market should fail closed');
eq(buildSettlementTradePlan({ ...request, serviceId: 'tavern' }).reason, 'unsupported-service', 'non-market services must not trade');

eq(buildSettlementTradePlan({ ...request, direction: 'sell', quantity: 2, inventory: { iron_ore: 3 }, stock: { iron_ore: 0 }, copper: 0 }).copperDelta, 6, 'sell should credit copper');

console.log(`PASS checkSettlementTradePlan: ${checks} assertions`);
