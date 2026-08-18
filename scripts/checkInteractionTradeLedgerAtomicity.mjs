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
assert.equal(economy.purchase(whetstone, grant).ok, true);
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
		...committed.ledger,
		purchasesByOffer: { ...committed.ledger.purchasesByOffer, unknown: 999 },
		recentTransactions: [
			{ ...committed.ledger.recentTransactions[0], itemId: 'forged', spentCopper: 999 },
			committed.ledger.recentTransactions[1],
			{ sequence: 2, offerId: 'unknown', balanceCopper: 0 },
			{ sequence: 3, offerId: ration.id, balanceCopper: 16 },
		],
	},
});
assert.deepEqual(restored.snapshot(), committed, 'restore must canonicalize receipts and ignore unknown/out-of-range entries');

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
const boundedHistory = historyEconomy.snapshot().ledger.recentTransactions;
assert.equal(historyEconomy.snapshot().ledger.transactionCount, 7);
assert.equal(boundedHistory.length, RECENT_TRANSACTION_LIMIT);
assert.deepEqual(boundedHistory.map((entry) => entry.sequence), [3, 4, 5, 6, 7]);
assert.equal(boundedHistory.at(-1).offerId, rationAllotment.id);

const restoredDetached = restored.snapshot();
restoredDetached.ledger.purchasesByOffer[ration.id] = 77;
restoredDetached.ledger.recentTransactions[0].sequence = 77;
assert.equal(restored.snapshot().ledger.purchasesByOffer[ration.id], 1);
assert.equal(restored.snapshot().ledger.recentTransactions[0].sequence, 1);

console.log('PASS checkInteractionTradeLedgerAtomicity: quotes are deterministic, failed trades are atomic, receipts are detached/canonicalized/bounded, and restore ignores unknown offers.');
