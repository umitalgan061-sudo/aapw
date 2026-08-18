import assert from 'node:assert/strict';
import {
	QUARTERMASTER_NPC_ID,
	QUARTERMASTER_OFFERS,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import { createInteractionInventoryState } from '../src/3d/gameplay/interactionConfig.js';

const vendorOffer = QUARTERMASTER_OFFERS[0];
const armorerOffer = QUARTERMASTER_OFFERS.find((offer) => offer.fulfillment?.serviceId === 'dragonstone-watch-armorer-honing');
const rationServiceOffer = QUARTERMASTER_OFFERS.find((offer) => offer.fulfillment?.serviceId === 'dragonstone-watch-ration-prep');
assert.ok(armorerOffer, 'quartermaster must expose the Dragonstone armorer service');
assert.ok(rationServiceOffer, 'quartermaster must retain the ration-prep settlement service');
assert.equal(armorerOffer.id, 'dragonstone-whetstone');
assert.deepEqual(armorerOffer.fulfillment, {
	kind: 'settlement-service',
	serviceId: 'dragonstone-watch-armorer-honing',
	label: 'Zırhçı bileme hazırlığı',
	stationId: 'dragonstone-armorer-bench',
	discipline: 'smithing',
});
assert.deepEqual(rationServiceOffer.fulfillment, {
	kind: 'settlement-service',
	serviceId: 'dragonstone-watch-ration-prep',
	label: 'Erzak hazırlama',
	stationId: 'dragonstone-ration-prep-table',
	discipline: 'provisioning',
	craftUpgrade: {
		recipeId: 'dragonstone-watch-travel-ration-pack',
		inputItemId: 'dragonstone-field-ration',
		inputQuantity: 2,
		outputItemId: 'dragonstone-travel-ration-pack',
		outputQuantity: 1,
		label: '2 saha azığını 1 yol azığı paketine hazırla',
	},
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

const armorerInventory = createInteractionInventoryState();
const armorerEconomy = createInteractionEconomyState();
const armorerBefore = structuredClone(armorerEconomy.snapshot());
result = armorerEconomy.purchase(armorerOffer, (...args) => armorerInventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.spentCopper, 12);
assert.equal(result.balanceCopper, 28);
assert.equal(result.remainingStock, 1);
assert.equal(result.ledger.transactionCount, 1);
assert.equal(result.ledger.lifetimeSpentCopper, 12);
assert.equal(result.ledger.purchasesByOffer[armorerOffer.id], 1);
assert.deepEqual(result.ledger.recentTransactions, [{
	sequence: 1,
	offerId: armorerOffer.id,
	itemId: armorerOffer.itemId,
	quantity: armorerOffer.quantity,
	spentCopper: armorerOffer.priceCopper,
	balanceCopper: 28,
}]);
assert.deepEqual(
	armorerInventory.snapshot().items.find((item) => item.itemId === armorerOffer.itemId)?.provenance,
	[{ sourceType: 'settlement-service', sourceId: 'dragonstone-watch-armorer-honing' }],
	'armorer fulfillment must persist smithing-service provenance',
);
assert.notDeepEqual(armorerEconomy.snapshot(), armorerBefore, 'successful armorer service must mutate finite stock and ledger state');

const armorerSaved = structuredClone(armorerEconomy.snapshot());
const armorerRestored = createInteractionEconomyState();
armorerRestored.restore(armorerSaved);
assert.deepEqual(armorerRestored.snapshot(), armorerSaved, 'armorer settlement-service ledger/stock must survive save restore');

const rationInventory = createInteractionInventoryState();
const rationEconomy = createInteractionEconomyState();
const before = structuredClone(rationEconomy.snapshot());
result = rationEconomy.purchase(rationServiceOffer, (...args) => rationInventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.crafted, false, 'ration service without two carried inputs must preserve legacy one-ration fulfillment');
assert.equal(result.spentCopper, 5);
assert.equal(result.balanceCopper, 35);
assert.equal(result.remainingStock, 0);
assert.equal(result.ledger.transactionCount, 1);
assert.equal(result.ledger.lifetimeSpentCopper, 5);
assert.equal(result.ledger.purchasesByOffer[rationServiceOffer.id], 1);
assert.deepEqual(result.ledger.recentTransactions, [{
	sequence: 1,
	offerId: rationServiceOffer.id,
	itemId: rationServiceOffer.itemId,
	quantity: rationServiceOffer.quantity,
	spentCopper: rationServiceOffer.priceCopper,
	balanceCopper: 35,
}]);
assert.deepEqual(
	rationInventory.snapshot().items.find((item) => item.itemId === rationServiceOffer.itemId)?.provenance,
	[{ sourceType: 'settlement-service', sourceId: 'dragonstone-watch-ration-prep' }],
	'ration fulfillment must persist its service identity in inventory provenance',
);

const after = structuredClone(rationEconomy.snapshot());
result = rationEconomy.purchase(rationServiceOffer, (...args) => rationInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'out-of-stock');
assert.deepEqual(rationEconomy.snapshot(), after, 'sold-out service attempts must remain economy-atomic');
assert.notDeepEqual(after, before, 'successful service must mutate finite stock and ledger state');

const restored = createInteractionEconomyState();
restored.restore(after);
assert.deepEqual(restored.snapshot(), after, 'ration settlement service ledger/stock must survive save restore');

console.log('PASS checkInteractionSettlementServiceContract: vendor provenance stays vendor, armorer honing and ration prep retain canonical settlement-service behavior, provisioning metadata is explicit, and finite service state persists.');
