import assert from 'node:assert/strict';

import {
	createInteractionInventoryState,
	INTERACTION_ITEMS,
} from '../src/3d/gameplay/interactionConfig.js';
import {
	createInteractionEconomyState,
	QUARTERMASTER_OFFERS,
	STARTING_COPPER,
} from '../src/3d/gameplay/interactionEconomy.js';

const whetstoneOffer = QUARTERMASTER_OFFERS.find((offer) => offer.id === 'dragonstone-whetstone');
assert.ok(whetstoneOffer, 'canonical Dragonstone whetstone service must exist');
assert.equal(whetstoneOffer.fulfillment?.kind, 'settlement-service');
assert.equal(whetstoneOffer.fulfillment?.discipline, 'smithing');
assert.equal(whetstoneOffer.fulfillment?.stationId, 'dragonstone-armorer-bench');
assert.equal(whetstoneOffer.fulfillment?.craftUpgrade?.recipeId, 'dragonstone-expedition-maintenance-kit');

const inventory = createInteractionInventoryState();
const economy = createInteractionEconomyState();

// The mastery reward supplies the authored whetstone; the player also needs one travel pack.
assert.equal(inventory.grant('dragonstone-whetstone', 1, {
	sourceType: 'quest-reward',
	sourceId: 'dragonstone-expedition-mastery',
}), true);
assert.equal(inventory.grant('dragonstone-travel-ration-pack', 1, {
	sourceType: 'settlement-service',
	sourceId: 'dragonstone-watch-ration-prep',
}), true);

const beforeInventory = inventory.snapshot();
const beforeEconomy = economy.snapshot();
assert.equal(beforeInventory.fieldReadiness.capabilities.fastTravelEligible, false, 'raw smithing inputs must not grant maintenance-kit travel eligibility before crafting');
assert.equal(beforeInventory.items.find((item) => item.itemId === 'dragonstone-whetstone')?.quantity, 1);
assert.equal(beforeInventory.items.find((item) => item.itemId === 'dragonstone-travel-ration-pack')?.quantity, 1);
assert.equal(beforeEconomy.copper, STARTING_COPPER);

const purchase = economy.purchase(whetstoneOffer, (itemId, quantity, provenance) => inventory.grant(itemId, quantity, provenance));
assert.equal(purchase.ok, true, 'smithing settlement service must complete');
assert.equal(purchase.crafted, true, 'service must use the existing crafting path');
assert.equal(purchase.craftedItemId, 'dragonstone-expedition-maintenance-kit');
assert.deepEqual(purchase.consumedItems, [
	{ itemId: 'dragonstone-travel-ration-pack', quantity: 1 },
	{ itemId: 'dragonstone-whetstone', quantity: 1 },
]);
assert.equal(purchase.spentCopper, 12);
assert.equal(purchase.balanceCopper, STARTING_COPPER - 12);
assert.equal(purchase.remainingStock, whetstoneOffer.stockLimit - 1);

const afterInventory = inventory.snapshot();
const afterEconomy = economy.snapshot();
assert.equal(afterInventory.items.some((item) => item.itemId === 'dragonstone-whetstone'), false);
assert.equal(afterInventory.items.some((item) => item.itemId === 'dragonstone-travel-ration-pack'), false);
const kit = afterInventory.items.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit');
assert.ok(kit, 'maintenance kit must be present after atomic smithing');
assert.equal(kit.quantity, 1);
assert.equal(kit.rarity, INTERACTION_ITEMS['dragonstone-expedition-maintenance-kit'].rarity);
assert.deepEqual(kit.provenance, [{
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-expedition-maintenance-kit',
}]);
assert.equal(afterInventory.fieldReadiness.capabilities.fastTravelEligible, true, 'crafted maintenance kit must unlock the existing travel-readiness capability');
assert.equal(afterInventory.fieldReadiness.equipped?.itemId, 'dragonstone-expedition-maintenance-kit');
assert.equal(afterEconomy.ledger.transactionCount, 1);
assert.equal(afterEconomy.ledger.lifetimeSpentCopper, 12);
assert.equal(afterEconomy.ledger.purchasesByOffer['dragonstone-whetstone'], 1);
assert.equal(afterEconomy.ledger.recentTransactions.at(-1)?.offerId, 'dragonstone-whetstone');

// Save/load must preserve both the crafted item provenance and finite-stock economy state.
const restoredInventory = createInteractionInventoryState();
restoredInventory.restore(JSON.parse(JSON.stringify(afterInventory)));
assert.deepEqual(restoredInventory.snapshot(), afterInventory);

const restoredEconomy = createInteractionEconomyState();
restoredEconomy.restore(JSON.parse(JSON.stringify(afterEconomy)));
assert.deepEqual(restoredEconomy.snapshot(), afterEconomy);

// The restored finite stock remains authoritative; a fresh forged aggregate must not replenish it.
const forged = JSON.parse(JSON.stringify(afterEconomy));
forged.ledger.transactionCount = 0;
forged.ledger.lifetimeSpentCopper = 0;
forged.ledger.purchasesByOffer['dragonstone-whetstone'] = 0;
const hardenedEconomy = createInteractionEconomyState();
hardenedEconomy.restore(forged);
const hardened = hardenedEconomy.snapshot();
assert.equal(hardened.stockByOffer['dragonstone-whetstone'], whetstoneOffer.stockLimit - 1);
assert.equal(hardened.ledger.transactionCount, 1);
assert.equal(hardened.ledger.lifetimeSpentCopper, 12);
assert.equal(hardened.ledger.purchasesByOffer['dragonstone-whetstone'], 1);

console.log('INTERACTION_SMITHING_SERVICE_PERSISTENCE_OK', JSON.stringify({
	stationId: whetstoneOffer.fulfillment.stationId,
	discipline: whetstoneOffer.fulfillment.discipline,
	recipeId: whetstoneOffer.fulfillment.craftUpgrade.recipeId,
	spentCopper: purchase.spentCopper,
	remainingStock: purchase.remainingStock,
	craftedItemId: purchase.craftedItemId,
	inventorySaveLoad: true,
	economySaveLoad: true,
}));
