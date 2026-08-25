import assert from 'node:assert/strict';
import { createInteractionController } from '../src/3d/gameplay/interaction.js';
import {
	QUARTERMASTER_NPC_ID,
	QUARTERMASTER_OFFERS,
	RECENT_TRANSACTION_LIMIT,
	STARTING_COPPER,
	buildQuartermasterText,
	createInteractionEconomyState,
} from '../src/3d/gameplay/interactionEconomy.js';
import { INTERACTION_CONFIG, INTERACTION_ITEMS, createInteractionInventoryState } from '../src/3d/gameplay/interactionConfig.js';

const ration = QUARTERMASTER_OFFERS[0];
const whetstone = QUARTERMASTER_OFFERS[1];
const rationAllotment = QUARTERMASTER_OFFERS[2];
const receipt = (sequence, offer, balanceCopper) => ({
	sequence,
	offerId: offer.id,
	itemId: offer.itemId,
	quantity: offer.quantity,
	spentCopper: offer.priceCopper,
	balanceCopper,
});
const emptyLedger = () => ({
	transactionCount: 0,
	lifetimeSpentCopper: 0,
	purchasesByOffer: {
		'dragonstone-field-ration': 0,
		'dragonstone-whetstone': 0,
		'dragonstone-watch-ration-allotment': 0,
	},
	recentTransactions: [],
});

assert.equal(QUARTERMASTER_NPC_ID, 'stannis-guard-1');
assert.equal(STARTING_COPPER, 40);
assert.equal(RECENT_TRANSACTION_LIMIT, 5);
assert.equal(QUARTERMASTER_OFFERS.length, 3);
assert.equal(ration.stockLimit, 4);
assert.equal(whetstone.stockLimit, 2);
assert.equal(rationAllotment.id, 'dragonstone-watch-ration-allotment');
assert.equal(rationAllotment.itemId, 'dragonstone-travel-ration-pack');
assert.equal(rationAllotment.priceCopper, 5);
assert.equal(rationAllotment.stockLimit, 1);
assert.equal(rationAllotment.fulfillment?.serviceId, 'dragonstone-watch-ration-prep');
assert.ok(INTERACTION_ITEMS[ration.itemId]);
assert.ok(INTERACTION_ITEMS[whetstone.itemId]);
assert.ok(INTERACTION_ITEMS[rationAllotment.itemId]);

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState();
const grant = (itemId, quantity, provenance) => inventory.grant(itemId, quantity, provenance);
assert.deepEqual(economy.snapshot(), {
	copper: 40,
	stockByOffer: {
		'dragonstone-field-ration': 4,
		'dragonstone-whetstone': 2,
		'dragonstone-watch-ration-allotment': 1,
	},
	ledger: emptyLedger(),
});

let result = economy.purchase(ration, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 34);
assert.equal(result.remainingStock, 3);
assert.deepEqual(result.ledger.recentTransactions, [receipt(1, ration, 34)]);
assert.deepEqual(
	inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.provenance,
	[{ sourceType: 'vendor', sourceId: QUARTERMASTER_NPC_ID }],
);

result = economy.purchase(whetstone, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 22);
assert.equal(result.remainingStock, 1);
assert.deepEqual(economy.snapshot().ledger, {
	transactionCount: 2,
	lifetimeSpentCopper: 18,
	purchasesByOffer: {
		'dragonstone-field-ration': 1,
		'dragonstone-whetstone': 1,
		'dragonstone-watch-ration-allotment': 0,
	},
	recentTransactions: [receipt(1, ration, 34), receipt(2, whetstone, 22)],
});

result = economy.purchase(rationAllotment, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 17);
assert.equal(result.remainingStock, 0);
assert.equal(inventory.snapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 1, 'service must not add a plain field ration');
const preparedProvision = inventory.snapshot().items.find((item) => item.itemId === rationAllotment.itemId);
assert.equal(preparedProvision?.quantity, 1);
assert.deepEqual(preparedProvision?.provenance, [{ sourceType: 'settlement-service', sourceId: 'dragonstone-watch-ration-prep' }]);
assert.deepEqual(result.ledger, {
	transactionCount: 3,
	lifetimeSpentCopper: 23,
	purchasesByOffer: {
		'dragonstone-field-ration': 1,
		'dragonstone-whetstone': 1,
		'dragonstone-watch-ration-allotment': 1,
	},
	recentTransactions: [receipt(1, ration, 34), receipt(2, whetstone, 22), receipt(3, rationAllotment, 17)],
});
const allotmentBefore = structuredClone(economy.snapshot());
result = economy.purchase(rationAllotment, grant);
assert.equal(result.reason, 'out-of-stock');
assert.deepEqual(economy.snapshot(), allotmentBefore);

const stockEconomy = createInteractionEconomyState(100);
const stockInventory = createInteractionInventoryState();
for (let index = 0; index < whetstone.stockLimit; index += 1) {
	assert.equal(stockEconomy.purchase(whetstone, (...args) => stockInventory.grant(...args)).ok, true);
}
const stockBefore = structuredClone(stockEconomy.snapshot());
const inventoryBefore = structuredClone(stockInventory.snapshot());
result = stockEconomy.purchase(whetstone, (...args) => stockInventory.grant(...args));
assert.equal(result.reason, 'out-of-stock');
assert.deepEqual(stockEconomy.snapshot(), stockBefore);
assert.deepEqual(stockInventory.snapshot(), inventoryBefore);

const fullEconomy = createInteractionEconomyState(100);
const fullInventory = createInteractionInventoryState();
for (let index = 0; index < INTERACTION_ITEMS[ration.itemId].stackLimit; index += 1) fullInventory.grant(ration.itemId, 1);
const fullBefore = structuredClone(fullEconomy.snapshot());
result = fullEconomy.purchase(ration, (...args) => fullInventory.grant(...args));
assert.equal(result.reason, 'inventory-full');
assert.deepEqual(fullEconomy.snapshot(), fullBefore);

const fullProvisionEconomy = createInteractionEconomyState(100);
const fullProvisionInventory = createInteractionInventoryState();
for (let index = 0; index < INTERACTION_ITEMS[rationAllotment.itemId].stackLimit; index += 1) fullProvisionInventory.grant(rationAllotment.itemId, 1);
const fullProvisionBefore = structuredClone(fullProvisionEconomy.snapshot());
result = fullProvisionEconomy.purchase(rationAllotment, (...args) => fullProvisionInventory.grant(...args));
assert.equal(result.reason, 'inventory-full');
assert.deepEqual(fullProvisionEconomy.snapshot(), fullProvisionBefore, 'failed prepared-provision fulfillment must not spend copper or stock');

const poorEconomy = createInteractionEconomyState(4);
const poorBefore = structuredClone(poorEconomy.snapshot());
result = poorEconomy.purchase(rationAllotment, () => true);
assert.equal(result.reason, 'insufficient-funds');
assert.deepEqual(poorEconomy.snapshot(), poorBefore);

const saved = economy.snapshot();
const restored = createInteractionEconomyState(0);
restored.restore(saved);
assert.deepEqual(restored.snapshot(), saved);
restored.restore({ copper: 17 });
assert.deepEqual(restored.snapshot(), {
	copper: 17,
	stockByOffer: {
		'dragonstone-field-ration': 4,
		'dragonstone-whetstone': 2,
		'dragonstone-watch-ration-allotment': 1,
	},
	ledger: emptyLedger(),
});

restored.restore({
	copper: 17,
	stockByOffer: { [ration.id]: 999, [whetstone.id]: -2, [rationAllotment.id]: 99 },
	ledger: {
		transactionCount: 999,
		lifetimeSpentCopper: 999,
		purchasesByOffer: { [ration.id]: 99, [whetstone.id]: 99, [rationAllotment.id]: 99, unknown: 999 },
		recentTransactions: [{ sequence: 1, offerId: ration.id, balanceCopper: 11 }],
	},
});
assert.deepEqual(restored.snapshot().ledger, emptyLedger(), 'sanitized full stock must defeat forged aggregate purchase history');

const depletedStock = {
	[ration.id]: ration.stockLimit - 1,
	[whetstone.id]: whetstone.stockLimit - 1,
	[rationAllotment.id]: rationAllotment.stockLimit - 1,
};
restored.restore({
	copper: 17,
	stockByOffer: depletedStock,
	ledger: {
		transactionCount: 300,
		lifetimeSpentCopper: 2300,
		purchasesByOffer: { [ration.id]: 100, [whetstone.id]: 100, [rationAllotment.id]: 100, unknown: 999 },
		recentTransactions: [
			{ sequence: 2, offerId: whetstone.id, itemId: 'forged', spentCopper: 999, balanceCopper: 22 },
			{ sequence: 3, offerId: rationAllotment.id, itemId: 'forged', spentCopper: 999, balanceCopper: 17 },
			{ sequence: 4, offerId: ration.id, balanceCopper: 11 },
			{ sequence: 1, offerId: 'unknown', balanceCopper: 34 },
		],
	},
});
assert.deepEqual(restored.snapshot(), {
	copper: 17,
	stockByOffer: depletedStock,
	ledger: {
		transactionCount: 3,
		lifetimeSpentCopper: 23,
		purchasesByOffer: {
			'dragonstone-field-ration': 1,
			'dragonstone-whetstone': 1,
			'dragonstone-watch-ration-allotment': 1,
		},
		recentTransactions: [receipt(2, whetstone, 22), receipt(3, rationAllotment, 17)],
	},
});

const legacyStockAware = createInteractionEconomyState(0);
legacyStockAware.restore({ copper: 17, stockByOffer: depletedStock });
assert.equal(legacyStockAware.snapshot().ledger.transactionCount, 3);
assert.equal(legacyStockAware.snapshot().ledger.lifetimeSpentCopper, 23);
assert.deepEqual(legacyStockAware.snapshot().ledger.recentTransactions, []);

const text = buildQuartermasterText(saved, QUARTERMASTER_OFFERS, 'Satın alma tamamlandı.');
assert.match(text, /Kese: 17 bakır/);
assert.match(text, /Alışveriş defteri: 3 işlem · 23 bakır harcandı/);
assert.match(text, /Son işlem: #3 Nöbetçi yol azığı hazırlama hizmeti · 5 bakır · bakiye 17/);
assert.match(text, /saha azığı — 6 bakır · stok 3\/4 · aldın 1/);
assert.match(text, /bileği taşı — 12 bakır · stok 1\/2 · aldın 1/);
assert.match(text, /Nöbetçi yol azığı hazırlama hizmeti — 5 bakır · stok 0\/1 · aldın 1/);

const dialogueHistory = [];
const economyChanges = [];
const inventoryChanges = [];
const quartermaster = { object3D: { name: QUARTERMASTER_NPC_ID, position: { x: 0, z: 0 } }, displayName: 'Kapı Nöbetçisi' };
const controller = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show: (body, choices = []) => dialogueHistory.push({ body, choices }), hide() {} },
	greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE,
	greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
	choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
	radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
	onEconomyChanged: (snapshot) => economyChanges.push(structuredClone(snapshot)),
	onInventoryChanged: (snapshot) => inventoryChanges.push(structuredClone(snapshot)),
});
controller.update([quartermaster], { x: 0, z: 0 });
controller.handleKeyDown({ code: 'KeyB', repeat: false });
assert.match(dialogueHistory.at(-1).body, /Nöbetçi yol azığı hazırlama hizmeti — 5 bakır · stok 1\/1 · aldın 0/);
assert.equal(dialogueHistory.at(-1).choices.length, 3);
controller.handleKeyDown({ code: 'Digit3', repeat: false });
assert.equal(controller.getEconomySnapshot().copper, 35);
assert.equal(controller.getEconomySnapshot().stockByOffer[rationAllotment.id], 0);
assert.deepEqual(controller.getEconomySnapshot().ledger.recentTransactions, [receipt(1, rationAllotment, 35)]);
const runtimeProvision = controller.getInventorySnapshot().items.find((item) => item.itemId === rationAllotment.itemId);
assert.equal(runtimeProvision?.quantity, 1);
assert.deepEqual(runtimeProvision?.provenance, [{ sourceType: 'settlement-service', sourceId: 'dragonstone-watch-ration-prep' }]);
assert.equal(controller.getInventorySnapshot().items.some((item) => item.itemId === ration.itemId), false);
assert.match(dialogueHistory.at(-1).body, /Alışveriş defteri: 1 işlem · 5 bakır harcandı/);
assert.match(dialogueHistory.at(-1).body, /Son işlem: #1 Nöbetçi yol azığı hazırlama hizmeti · 5 bakır · bakiye 35/);
assert.match(dialogueHistory.at(-1).body, /Nöbetçi yol azığı hazırlama hizmeti — 5 bakır · stok 0\/1 · aldın 1/);
assert.equal(economyChanges.length, 1);
assert.equal(inventoryChanges.length, 1);

const runtimeSaved = controller.getRpgSnapshot();
assert.equal(runtimeSaved.schemaVersion, 5);
const runtimeRestored = createInteractionController({
	interactionPrompt: { setVisible() {} },
	dialogueBox: { show() {}, hide() {} },
	greetingTemplate: INTERACTION_CONFIG.GREETING_TEMPLATE,
	greetingsByNpcId: INTERACTION_CONFIG.GREETINGS_BY_NPC_ID,
	choicesByNpcId: INTERACTION_CONFIG.CHOICES_BY_NPC_ID,
	radiusMeters: INTERACTION_CONFIG.PROMPT_RADIUS_METERS,
});
runtimeRestored.restoreRpgSnapshot(runtimeSaved);
assert.deepEqual(runtimeRestored.getEconomySnapshot(), runtimeSaved.economy);
assert.deepEqual(runtimeRestored.getInventorySnapshot(), runtimeSaved.inventory);

console.log('PASS checkInteractionQuartermasterTrade: deterministic purse, finite stock, stock-derived ledger integrity, forged-history repair, atomic failures, shipped Digit3 prepared-provision UX, provenance, and save/load verified.');
