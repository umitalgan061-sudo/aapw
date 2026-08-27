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
	craftUpgrade: {
		recipeId: 'dragonstone-expedition-maintenance-kit',
		inputs: [
			{ itemId: 'dragonstone-travel-ration-pack', quantity: 1 },
			{ itemId: 'dragonstone-whetstone', quantity: 1 },
		],
		outputItemId: 'dragonstone-expedition-maintenance-kit',
		outputQuantity: 1,
		label: '1 yol azığı paketi + 1 bileği taşını 1 sefer bakım kitine hazırla',
	},
});
assert.equal(rationServiceOffer.itemId, 'dragonstone-travel-ration-pack');
assert.equal(rationServiceOffer.quantity, 1);
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
const armorerBlockedInventory = structuredClone(armorerInventory.snapshot());
const armorerBlockedEconomy = structuredClone(armorerEconomy.snapshot());
result = armorerEconomy.purchase(armorerOffer, (...args) => armorerInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'craft-input-missing');
assert.deepEqual(armorerInventory.snapshot(), armorerBlockedInventory, 'armorer service must not mint a whetstone fallback');
assert.deepEqual(armorerEconomy.snapshot(), armorerBlockedEconomy, 'blocked armorer service must not spend copper, stock or ledger entries');

assert.equal(armorerInventory.grant('dragonstone-travel-ration-pack', 1, { sourceType: 'quest-reward', sourceId: 'settlement-service-fixture' }), true);
assert.equal(armorerInventory.grant('dragonstone-whetstone', 1, { sourceType: 'quest-reward', sourceId: 'settlement-service-fixture' }), true);
result = armorerEconomy.purchase(armorerOffer, (...args) => armorerInventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.crafted, true);
assert.equal(result.craftedItemId, 'dragonstone-expedition-maintenance-kit');
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
const maintenanceKit = armorerInventory.snapshot().items.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit');
assert.equal(maintenanceKit?.quantity, 1);
assert.deepEqual(
	maintenanceKit?.provenance,
	[{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }],
	'armorer output must persist authored smithing recipe provenance',
);
assert.equal(armorerInventory.snapshot().items.some((item) => item.itemId === 'dragonstone-travel-ration-pack'), false);
assert.equal(armorerInventory.snapshot().items.some((item) => item.itemId === 'dragonstone-whetstone'), false);

const armorerSaved = structuredClone(armorerEconomy.snapshot());
const armorerRestored = createInteractionEconomyState();
armorerRestored.restore(armorerSaved);
assert.deepEqual(armorerRestored.snapshot(), armorerSaved, 'armorer settlement-service ledger/stock must survive save restore');

const rationInventory = createInteractionInventoryState();
const rationEconomy = createInteractionEconomyState();
const rationBlockedInventory = structuredClone(rationInventory.snapshot());
const rationBlockedEconomy = structuredClone(rationEconomy.snapshot());
result = rationEconomy.purchase(rationServiceOffer, (...args) => rationInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'craft-input-missing');
assert.deepEqual(rationInventory.snapshot(), rationBlockedInventory, 'ration prep must fail closed without two field rations');
assert.deepEqual(rationEconomy.snapshot(), rationBlockedEconomy, 'blocked ration prep must not mutate finite stock or ledger');

assert.equal(rationInventory.grant('dragonstone-field-ration', 2, { sourceType: 'quest-reward', sourceId: 'settlement-service-fixture' }), true);
result = rationEconomy.purchase(rationServiceOffer, (...args) => rationInventory.grant(...args));
assert.equal(result.ok, true);
assert.equal(result.crafted, true);
assert.equal(result.craftedItemId, 'dragonstone-travel-ration-pack');
assert.equal(result.consumedItemId, 'dragonstone-field-ration');
assert.equal(result.consumedQuantity, 2);
assert.equal(result.spentCopper, 5);
assert.equal(result.balanceCopper, 35);
assert.equal(result.remainingStock, 0);
assert.equal(result.ledger.transactionCount, 1);
assert.equal(result.ledger.lifetimeSpentCopper, 5);
assert.equal(result.ledger.purchasesByOffer[rationServiceOffer.id], 1);
const preparedProvision = rationInventory.snapshot().items.find((item) => item.itemId === rationServiceOffer.itemId);
assert.equal(preparedProvision?.quantity, 1);
assert.deepEqual(
	preparedProvision?.provenance,
	[{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }],
	'prepared travel provisions must persist authored provisioning recipe provenance',
);
assert.equal(rationInventory.snapshot().items.some((item) => item.itemId === 'dragonstone-field-ration'), false);

const after = structuredClone(rationEconomy.snapshot());
result = rationEconomy.purchase(rationServiceOffer, (...args) => rationInventory.grant(...args));
assert.equal(result.ok, false);
assert.equal(result.reason, 'out-of-stock');
assert.deepEqual(rationEconomy.snapshot(), after, 'sold-out service attempts must remain economy-atomic');

const restored = createInteractionEconomyState();
restored.restore(after);
assert.deepEqual(restored.snapshot(), after, 'ration settlement service ledger/stock must survive save restore');

console.log('PASS checkInteractionSettlementServiceContract: settlement services fail closed without authored inputs, commit atomically with real inputs, preserve crafting provenance, and persist finite service state.');
