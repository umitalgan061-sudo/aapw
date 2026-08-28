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
assert.equal(whetstone.fulfillment?.serviceId, 'dragonstone-watch-armorer-honing');
assert.equal(rationAllotment.fulfillment?.serviceId, 'dragonstone-watch-ration-prep');
assert.ok(INTERACTION_ITEMS[ration.itemId]);
assert.ok(INTERACTION_ITEMS[whetstone.itemId]);
assert.ok(INTERACTION_ITEMS[rationAllotment.itemId]);

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState();
const grant = (itemId, quantity, provenance) => inventory.grant(itemId, quantity, provenance);
assert.deepEqual(economy.snapshot().ledger, emptyLedger());

let result = economy.purchase(ration, grant);
assert.equal(result.ok, true);
assert.equal(result.balanceCopper, 34);
assert.equal(result.remainingStock, 3);
assert.deepEqual(result.ledger.recentTransactions, [receipt(1, ration, 34)]);

const beforeBlockedSmithingInventory = structuredClone(inventory.snapshot());
const beforeBlockedSmithingEconomy = structuredClone(economy.snapshot());
result = economy.purchase(whetstone, grant);
assert.equal(result.ok, false);
assert.equal(result.reason, 'craft-input-missing');
assert.deepEqual(inventory.snapshot(), beforeBlockedSmithingInventory, 'armorer service must fail closed without authored smithing inputs');
assert.deepEqual(economy.snapshot(), beforeBlockedSmithingEconomy, 'blocked armorer service must not spend copper, stock or ledger entries');

const beforeBlockedProvisionInventory = structuredClone(inventory.snapshot());
const beforeBlockedProvisionEconomy = structuredClone(economy.snapshot());
result = economy.purchase(rationAllotment, grant);
assert.equal(result.ok, false);
assert.equal(result.reason, 'craft-input-missing');
assert.deepEqual(inventory.snapshot(), beforeBlockedProvisionInventory, 'provisioning must fail closed until two field rations exist');
assert.deepEqual(economy.snapshot(), beforeBlockedProvisionEconomy);

assert.equal(inventory.grant(ration.itemId, 1, { sourceType: 'quest-reward', sourceId: 'quartermaster-trade-fixture' }), true);
result = economy.purchase(rationAllotment, grant);
assert.equal(result.ok, true);
assert.equal(result.crafted, true);
assert.equal(result.balanceCopper, 29);
assert.equal(result.remainingStock, 0);
assert.equal(inventory.snapshot().items.some((item) => item.itemId === ration.itemId), false);
const preparedProvision = inventory.snapshot().items.find((item) => item.itemId === rationAllotment.itemId);
assert.equal(preparedProvision?.quantity, 1);
assert.deepEqual(preparedProvision?.provenance, [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }]);
assert.deepEqual(result.ledger, {
	transactionCount: 2,
	lifetimeSpentCopper: 11,
	purchasesByOffer: {
		'dragonstone-field-ration': 1,
		'dragonstone-whetstone': 0,
		'dragonstone-watch-ration-allotment': 1,
	},
	recentTransactions: [receipt(1, ration, 34), receipt(2, rationAllotment, 29)],
});

const saved = economy.snapshot();
const restored = createInteractionEconomyState(0);
restored.restore(saved);
assert.deepEqual(restored.snapshot(), saved);
const text = buildQuartermasterText(saved, QUARTERMASTER_OFFERS, 'Satın alma tamamlandı.');
assert.match(text, /Kese: 29 bakır/);
assert.match(text, /Alışveriş defteri: 2 işlem · 11 bakır harcandı/);
assert.match(text, /bileği taşı — 12 bakır · stok 2\/2 · aldın 0/);
assert.match(text, /Nöbetçi yol azığı hazırlama hizmeti — 5 bakır · stok 0\/1 · aldın 1/);
assert.match(text, /DÖNÜŞÜM: 2 saha azığını 1 yol azığı paketine hazırla/);

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
assert.match(dialogueHistory.at(-1).body, /stok 4\/4/);
assert.equal(dialogueHistory.at(-1).choices.length, 3);

const runtimeBeforeBlockedSmithing = structuredClone(controller.getRpgSnapshot());
controller.handleKeyDown({ code: 'Digit2', repeat: false });
assert.deepEqual(controller.getEconomySnapshot(), runtimeBeforeBlockedSmithing.economy, 'Digit2 armorer service must fail closed without smithing inputs');
assert.deepEqual(controller.getInventorySnapshot(), runtimeBeforeBlockedSmithing.inventory);
assert.match(dialogueHistory.at(-1).body, /başarısız/i);
assert.equal(economyChanges.length, 0);
assert.equal(inventoryChanges.length, 0);

controller.handleKeyDown({ code: 'Digit1', repeat: false });
controller.handleKeyDown({ code: 'Digit1', repeat: false });
assert.equal(controller.getEconomySnapshot().copper, 28);
assert.equal(controller.getInventorySnapshot().items.find((item) => item.itemId === ration.itemId)?.quantity, 2);
controller.handleKeyDown({ code: 'Digit3', repeat: false });
assert.equal(controller.getEconomySnapshot().copper, 23);
assert.equal(controller.getEconomySnapshot().stockByOffer[rationAllotment.id], 0);
assert.deepEqual(controller.getEconomySnapshot().ledger, {
	transactionCount: 3,
	lifetimeSpentCopper: 17,
	purchasesByOffer: {
		'dragonstone-field-ration': 2,
		'dragonstone-whetstone': 0,
		'dragonstone-watch-ration-allotment': 1,
	},
	recentTransactions: [receipt(1, ration, 34), receipt(2, ration, 28), receipt(3, rationAllotment, 23)],
});
const runtimeProvision = controller.getInventorySnapshot().items.find((item) => item.itemId === rationAllotment.itemId);
assert.equal(runtimeProvision?.quantity, 1);
assert.deepEqual(runtimeProvision?.provenance, [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }]);
assert.equal(controller.getInventorySnapshot().items.some((item) => item.itemId === ration.itemId), false);
assert.equal(economyChanges.length, 3);
assert.equal(inventoryChanges.length, 3);

const runtimeSaved = controller.getRpgSnapshot();
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

console.log('PASS checkInteractionQuartermasterTrade: fail-closed armorer/provisioning services, atomic ration preparation, deterministic ledger, shipped vendor UX and save/load verified.');
