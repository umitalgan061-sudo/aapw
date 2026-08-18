import assert from 'node:assert/strict';
import {
	QUARTERMASTER_NPC_ID,
	QUARTERMASTER_OFFERS,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import { createInteractionInventoryState } from '../src/3d/gameplay/interactionConfig.js';

const vendorOffer = QUARTERMASTER_OFFERS[0];
const serviceOffer = QUARTERMASTER_OFFERS.find((offer) => offer.fulfillment?.kind === 'settlement-service');
assert.ok(serviceOffer, 'quartermaster must expose a settlement-service offer');
assert.equal(serviceOffer.id, 'dragonstone-watch-ration-allotment');
assert.deepEqual(serviceOffer.fulfillment, {
	kind: 'settlement-service',
	serviceId: 'dragonstone-watch-ration-prep',
	label: 'Erzak hazırlama',
});

const vendorInventory = createInteractionInventoryState();
const vendorEconomy = createInteractionEconomyState();
let result = vendorEconomy.purchase(vendorOffer, (...args) => vendorInventory.grant(...args));
assert.equal(result.ok, true);
assert.deepEqual(
	vendorInventory.snapshot().items.find((item) => item.itemId === vendorOffer.itemId)?.provenance,
	[{ sourceType: 'vendor', sourceId: QUARTERMASTER_NPC_ID }],
	'ordinary quartermaster purchases must retain vendor provenance',
);

const serviceInventory = createInteractionInventoryState();
const serviceEconomy = createInteractionEconomyState();
const before = structuredClone(serviceEconomy.snapshot());
result = serviceEconomy.purchase(serviceOffer, (...args) => serviceInventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.spentCopper, 5);
assert.equal(result.balanceCopper, 35);
assert.equal(result.remainingStock, 0);
assert.equal(result.ledger.transactionCount, 1);
assert.equal(result.ledger.lifetimeSpentCopper, 5);
assert.equal(result.ledger.purchasesByOffer[serviceOffer.id], 1);
assert.deepEqual(result.ledger.recentTransactions, [{
	sequence: 1,
	offerId: serviceOffer.id,
	itemId: serviceOffer.itemId,
	quantity: serviceOffer.quantity,
	spentCopper: serviceOffer.priceCopper,
	balanceCopper: 35,
}]);
assert.deepEqual(
	serviceInventory.snapshot().items.find((item) => item.itemId === serviceOffer.itemId)?.provenance,
	[{ sourceType: 'settlement-service', sourceId: 'dragonstone-watch-ration-prep' }],
	'settlement fulfillment must persist its service identity in inventory provenance',
);

const after = structuredClone(serviceEconomy.snapshot());
result = serviceEconomy.purchase(serviceOffer, (...args) => serviceInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'out-of-stock');
assert.deepEqual(serviceEconomy.snapshot(), after, 'sold-out service attempts must remain economy-atomic');
assert.notDeepEqual(after, before, 'successful service must mutate finite stock and ledger state');

const restored = createInteractionEconomyState();
restored.restore(after);
assert.deepEqual(restored.snapshot(), after, 'settlement service ledger/stock must survive save restore');

console.log('PASS checkInteractionSettlementServiceContract: vendor provenance stays vendor, ration prep uses settlement-service provenance, and finite service state persists atomically.');
