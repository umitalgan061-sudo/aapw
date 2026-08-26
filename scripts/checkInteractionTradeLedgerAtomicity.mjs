import assert from 'node:assert/strict';
import {
	QUARTERMASTER_OFFERS,
	RECENT_TRANSACTION_LIMIT,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import { createInteractionInventoryState, INTERACTION_ITEMS } from '../src/3d/gameplay/interactionConfig.js';

const ration = QUARTERMASTER_OFFERS[0];
const whetstone = QUARTERMASTER_OFFERS[1];
const rationAllotment = QUARTERMASTER_OFFERS[2];

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
assert.equal(inventory.grant('dragonstone-travel-ration-pack', 1, { sourceType: 'test-fixture', sourceId: 'trade-ledger-atomicity' }), true);
assert.equal(inventory.grant('dragonstone-whetstone', 1, { sourceType: 'test-fixture', sourceId: 'trade-ledger-atomicity' }), true);
result = economy.purchase(whetstone, grant);
assert.equal(result.ok, true, 'authored armorer service should commit after its canonical inputs are present');
assert.equal(result.crafted, true);
assert.equal(result.craftedItemId, 'dragonstone-expedition-maintenance-kit');
assert.deepEqual(result.consumedItems, [
	{ itemId: 'dragonstone-travel-ration-pack', quantity: 1 },
	{ itemId: 'dragonstone-whetstone', quantity: 1 },
]);
const committed = snapshot(economy);
assert.equal(committed.ledger.transactionCount, 2);
assert.equal(committed.ledger.lifetimeSpentCopper, ration.priceCopper + whetstone.priceCopper);
assert.equal(committed.ledger.purchasesByOffer[ration.id], 1);
assert.equal(committed.ledger.purchasesByOffer[whetstone.id], 1);
assert.deepEqual(committed.ledger.recentTransactions.map(({ sequence, offerId, balanceCopper }) => ({ sequence, offerId, balanceCopper })), [
	{ sequence: 1, offerId: ration.id, balanceCopper: 34 },
	{ sequence: 2, offerId: whetstone.id, balanceCopper: 22 },
]);

const detached = economy.snapshot();
detached.copper = 9999;
detached.stockByOffer[ration.id] = 0;
detached.ledger.transactionCount = 9999;
detached.ledger.purchasesByOffer[ration.id] = 9999;
detached.ledger.recentTransactions[0].balanceCopper = 9999;
assert.deepEqual(economy.snapshot(), committed, 'consumer mutation must not alter internal economy, ledger or receipts');

const restored = createInteractionEconomyState(0);
restored.restore({
	...committed,
	stockByOffer: { ...committed.stockByOffer, unknown: 999 },
	ledger: {
		transactionCount: 999,
		lifetimeSpentCopper: 9999,
		purchasesByOffer: { [ration.id]: 99, [whetstone.id]: 99, [rationAllotment.id]: 99, unknown: 999 },
		recentTransactions: [
			{ ...committed.ledger.recentTransactions[0], itemId: 'forged', spentCopper: 999 },
			committed.ledger.recentTransactions[1],
			{ sequence: 2, offerId: 'unknown', balanceCopper: 0 },
			{ sequence: 3, offerId: ration.id, balanceCopper: 16 },
		],
	},
});
assert.deepEqual(restored.snapshot(), committed, 'restore must derive totals from stock, canonicalize receipts and ignore forged aggregate fields');

const legacyStockOnly = createInteractionEconomyState(0);
legacyStockOnly.restore({ copper: 22, stockByOffer: committed.stockByOffer });
assert.deepEqual(legacyStockOnly.snapshot().ledger, {
	transactionCount: 2,
	lifetimeSpentCopper: 18,
	purchasesByOffer: {
		[ration.id]: 1,
		[whetstone.id]: 1,
		[rationAllotment.id]: 0,
	},
	recentTransactions: [],
}, 'stock-aware legacy saves must infer aggregate ledger totals without inventing receipt order');

const resumedLegacy = createInteractionEconomyState(0);
resumedLegacy.restore({
	copper: 34,
	stockByOffer: {
		[ration.id]: ration.stockLimit - 1,
		[whetstone.id]: whetstone.stockLimit,
		[rationAllotment.id]: rationAllotment.stockLimit,
	},
});
result = resumedLegacy.purchase(whetstone, () => true);
assert.equal(result.ok, true);
assert.equal(result.ledger.transactionCount, 2);
assert.equal(result.ledger.lifetimeSpentCopper, 18);
assert.deepEqual(result.ledger.recentTransactions, [{
	sequence: 2,
	offerId: whetstone.id,
	itemId: whetstone.itemId,
	quantity: whetstone.quantity,
	spentCopper: whetstone.priceCopper,
	balanceCopper: 22,
}], 'new receipt sequence must continue from stock-inferred legacy purchase count');

const stockWins = createInteractionEconomyState(0);
stockWins.restore({
	copper: 40,
	stockByOffer: {
		[ration.id]: ration.stockLimit,
		[whetstone.id]: whetstone.stockLimit,
		[rationAllotment.id]: rationAllotment.stockLimit,
	},
	ledger: {
		transactionCount: 7,
		lifetimeSpentCopper: 53,
		purchasesByOffer: { [ration.id]: 4, [whetstone.id]: 2, [rationAllotment.id]: 1 },
		recentTransactions: [{ sequence: 7, offerId: rationAllotment.id, balanceCopper: 0 }],
	},
});
assert.deepEqual(stockWins.snapshot().ledger, initialEconomy.ledger, 'full stock must override forged sold-out aggregate history');

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

const historyEconomy = createInteractionEconomyState(200);
for (let index = 0; index < ration.stockLimit; index += 1) assert.equal(historyEconomy.purchase(ration, () => true).ok, true);
for (let index = 0; index < whetstone.stockLimit; index += 1) assert.equal(historyEconomy.purchase(whetstone, () => true).ok, true);
for (let index = 0; index < rationAllotment.stockLimit; index += 1) assert.equal(historyEconomy.purchase(rationAllotment, () => true).ok, true);
const fullHistory = historyEconomy.snapshot();
const boundedHistory = fullHistory.ledger.recentTransactions;
assert.equal(fullHistory.ledger.transactionCount, 7);
assert.equal(fullHistory.ledger.lifetimeSpentCopper, 53);
assert.equal(boundedHistory.length, RECENT_TRANSACTION_LIMIT);
assert.deepEqual(boundedHistory.map((entry) => entry.sequence), [3, 4, 5, 6, 7]);
assert.equal(boundedHistory.at(-1).offerId, rationAllotment.id);

const boundedRestore = createInteractionEconomyState(0);
boundedRestore.restore({
	...fullHistory,
	ledger: {
		transactionCount: 700,
		lifetimeSpentCopper: 5300,
		purchasesByOffer: { [ration.id]: 400, [whetstone.id]: 200, [rationAllotment.id]: 100 },
		recentTransactions: [
			{ sequence: 1, offerId: ration.id, balanceCopper: 194 },
			...boundedHistory,
			{ sequence: 8, offerId: ration.id, balanceCopper: 0 },
		],
	},
});
assert.deepEqual(boundedRestore.snapshot(), fullHistory, 'restore must keep only the canonical last-five sequence window and stock-derived totals');

const restoredDetached = restored.snapshot();
restoredDetached.ledger.purchasesByOffer[ration.id] = 77;
restoredDetached.ledger.recentTransactions[0].sequence = 77;
assert.equal(restored.snapshot().ledger.purchasesByOffer[ration.id], 1);
assert.equal(restored.snapshot().ledger.recentTransactions[0].sequence, 1);

console.log('PASS checkInteractionTradeLedgerAtomicity: quotes stay pure, failed trades stay atomic, authored smithing commits against real inputs, stock canonically derives aggregate ledger totals, legacy saves infer totals, and receipt history stays detached/bounded.');
