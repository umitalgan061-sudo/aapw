import assert from 'node:assert/strict';
import {
	QUARTERMASTER_OFFERS,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import { createInteractionInventoryState, INTERACTION_ITEMS } from '../src/3d/gameplay/interactionConfig.js';

const ration = QUARTERMASTER_OFFERS[0];
const whetstone = QUARTERMASTER_OFFERS[1];

function snapshot(value) {
	return structuredClone(value.snapshot());
}

const economy = createInteractionEconomyState(40);
const inventory = createInteractionInventoryState();
const grant = (...args) => inventory.grant(...args);

const initialEconomy = snapshot(economy);
const initialInventory = snapshot(inventory);

assert.deepEqual(economy.quote(ration), {
	ok: true,
	reason: 'available',
	offerId: ration.id,
	remainingStock: ration.stockLimit,
	priceCopper: ration.priceCopper,
	balanceCopper: 40,
	balanceAfterPurchase: 34,
});
assert.deepEqual(economy.quote({ ...ration, id: 'forged-offer' }), { ok: false, reason: 'invalid-offer' });
assert.deepEqual(economy.snapshot(), initialEconomy, 'quote must be side-effect free');

let result = economy.purchase(null, grant);
assert.equal(result.reason, 'invalid-offer');
assert.deepEqual(economy.snapshot(), initialEconomy);
assert.deepEqual(inventory.snapshot(), initialInventory);

result = economy.purchase({ ...ration, id: 'forged-offer' }, grant);
assert.equal(result.reason, 'invalid-offer');
assert.deepEqual(economy.snapshot(), initialEconomy);
assert.deepEqual(inventory.snapshot(), initialInventory);

const poorEconomy = createInteractionEconomyState(0);
const poorBefore = snapshot(poorEconomy);
assert.deepEqual(poorEconomy.quote(ration), {
	ok: false,
	reason: 'insufficient-funds',
	offerId: ration.id,
	remainingStock: ration.stockLimit,
	priceCopper: ration.priceCopper,
	balanceCopper: 0,
	shortfallCopper: ration.priceCopper,
});
result = poorEconomy.purchase(ration, () => true);
assert.equal(result.reason, 'insufficient-funds');
assert.deepEqual(poorEconomy.snapshot(), poorBefore);

const fullEconomy = createInteractionEconomyState(100);
const fullInventory = createInteractionInventoryState();
for (let index = 0; index < INTERACTION_ITEMS[ration.itemId].stackLimit; index += 1) {
	assert.equal(fullInventory.grant(ration.itemId, 1), true);
}
const fullEconomyBefore = snapshot(fullEconomy);
const fullInventoryBefore = snapshot(fullInventory);
result = fullEconomy.purchase(ration, (...args) => fullInventory.grant(...args));
assert.equal(result.reason, 'inventory-full');
assert.equal(result.balanceAfterPurchase, 94, 'inventory-full failure may retain the side-effect-free quote preview');
assert.deepEqual(fullEconomy.snapshot(), fullEconomyBefore);
assert.deepEqual(fullInventory.snapshot(), fullInventoryBefore);

assert.equal(economy.purchase(ration, grant).ok, true);
assert.deepEqual(economy.quote(ration), {
	ok: true,
	reason: 'available',
	offerId: ration.id,
	remainingStock: ration.stockLimit - 1,
	priceCopper: ration.priceCopper,
	balanceCopper: 34,
	balanceAfterPurchase: 28,
});
assert.equal(economy.purchase(whetstone, grant).ok, true);
const committed = snapshot(economy);
assert.equal(committed.ledger.transactionCount, 2);
assert.equal(committed.ledger.lifetimeSpentCopper, ration.priceCopper + whetstone.priceCopper);
assert.equal(committed.ledger.purchasesByOffer[ration.id], 1);
assert.equal(committed.ledger.purchasesByOffer[whetstone.id], 1);

const detached = economy.snapshot();
detached.copper = 9999;
detached.stockByOffer[ration.id] = 0;
detached.ledger.transactionCount = 9999;
detached.ledger.purchasesByOffer[ration.id] = 9999;
assert.deepEqual(economy.snapshot(), committed, 'consumer mutation must not alter internal economy or ledger state');

const restored = createInteractionEconomyState(0);
restored.restore({
	...committed,
	stockByOffer: { ...committed.stockByOffer, unknown: 999 },
	ledger: {
		...committed.ledger,
		purchasesByOffer: { ...committed.ledger.purchasesByOffer, unknown: 999 },
	},
});
assert.deepEqual(restored.snapshot(), committed, 'unknown persisted offer ids must not enter runtime state');

const soldOut = createInteractionEconomyState(40);
for (let index = 0; index < ration.stockLimit; index += 1) assert.equal(soldOut.purchase(ration, () => true).ok, true);
assert.deepEqual(soldOut.quote(ration), {
	ok: false,
	reason: 'out-of-stock',
	offerId: ration.id,
	remainingStock: 0,
	priceCopper: ration.priceCopper,
	balanceCopper: 16,
});
const soldOutBefore = snapshot(soldOut);
assert.equal(soldOut.purchase(ration, () => true).reason, 'out-of-stock');
assert.deepEqual(soldOut.snapshot(), soldOutBefore);

const restoredDetached = restored.snapshot();
restoredDetached.ledger.purchasesByOffer[ration.id] = 77;
assert.equal(restored.snapshot().ledger.purchasesByOffer[ration.id], 1);

console.log('PASS checkInteractionTradeLedgerAtomicity: purchase quotes are deterministic/side-effect free, failed trades are atomic, committed ledger state is detached, and restore ignores unknown offers.');
