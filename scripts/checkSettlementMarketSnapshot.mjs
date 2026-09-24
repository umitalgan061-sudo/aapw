import assert from 'node:assert/strict';
import { buildSettlementMarketSnapshot, isSettlementMarketSnapshot } from '../src/3d/gameplay/settlementMarketSnapshot.ts';

let checks = 0;
const eq = (actual, expected, message) => { assert.equal(actual, expected, message); checks += 1; };
const ok = (value, message) => { assert.ok(value, message); checks += 1; };

const stock = { iron_ore: 10, wood: 3, malformed: 'bad' };
const prices = { iron_ore: 4, wood: 0 };
const first = buildSettlementMarketSnapshot({ serviceId: 'market', serviceOpen: true, copper: 9, stock, prices });
const second = buildSettlementMarketSnapshot({ serviceId: 'market', serviceOpen: true, copper: 9, stock: { malformed: 'bad', wood: 3, iron_ore: 10 }, prices: { wood: 0, iron_ore: 4 } });

eq(first.ok, true, 'market snapshot should be available');
eq(first.totalStock, 13, 'stock should be normalized and summed');
eq(first.entries[0].itemId, 'iron_ore', 'entries should use stable item ordering');
eq(first.entries[0].affordableQuantity, 2, 'affordable quantity should respect copper');
eq(first.entries[0].purchasable, true, 'priced stock should be purchasable when affordable');
eq(first.entries[1].purchasable, true, 'zero-price stock should remain purchasable');
eq(first.signature, second.signature, 'same normalized inputs should replay deterministically');
ok(isSettlementMarketSnapshot(first), 'snapshot should pass the frozen shape guard');
ok(Object.isFrozen(first), 'snapshot should be frozen');
ok(Object.isFrozen(first.entries[0]), 'entries should be frozen');
eq(stock.iron_ore, 10, 'caller stock must not mutate');
eq(buildSettlementMarketSnapshot({ serviceId: 'tavern', stock, prices }).reason, 'unsupported-service', 'non-market services must fail closed');
eq(buildSettlementMarketSnapshot({ serviceId: 'market', serviceOpen: false, stock, prices }).reason, 'service-closed', 'closed market must fail closed');
eq(buildSettlementMarketSnapshot({ serviceId: 'market', stock: {}, prices }).reason, 'missing-stock', 'missing stock must fail closed');

console.log(`PASS checkSettlementMarketSnapshot: ${checks} assertions`);
