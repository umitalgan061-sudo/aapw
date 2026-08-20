#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	INTERACTION_ITEMS,
	buildInventoryText,
	createInteractionInventoryState,
} from '../src/3d/gameplay/interactionConfig.js';
import {
	FAST_TRAVEL_BLOCK_REASON,
	FIELD_READINESS_ITEMS,
	FIELD_READINESS_TIER,
	buildFastTravelRequestText,
	buildFieldReadinessText,
	evaluateCraftAvailability,
	evaluateFastTravelRequest,
	evaluateFieldReadiness,
} from '../src/3d/gameplay/interactionFieldReadiness.js';
import { QUARTERMASTER_OFFERS } from '../src/3d/gameplay/interactionEconomy.js';

function item(snapshot, itemId) {
	return snapshot.items.find((entry) => entry.itemId === itemId) ?? null;
}

function grant(inventory, itemId, quantity = 1, sourceId = 'readiness-test') {
	return inventory.grant(itemId, quantity, { sourceType: 'test-fixture', sourceId });
}

const inventory = createInteractionInventoryState();
const empty = inventory.snapshot();
assert.equal(empty.fieldReadiness.tier, FIELD_READINESS_TIER.UNPREPARED);
assert.equal(empty.fieldReadiness.score, 0);
assert.equal(empty.fieldReadiness.equipped, null);
assert.deepEqual(empty.fieldReadiness.capabilityLabels, []);
assert.deepEqual(empty.fieldReadiness.missingForExpedition, [
	FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK,
	FIELD_READINESS_ITEMS.WHETSTONE,
]);
assert.match(buildInventoryText(empty), /Sefer hazırlığı: HAZIR DEĞİL · 0\/100/);

const blockedWithoutKit = evaluateFastTravelRequest(empty, {
	destinationId: 'dragonstone-harbor',
	discovered: true,
	routeOpen: true,
	distanceKm: 3.476,
});
assert.equal(blockedWithoutKit.allowed, false);
assert.deepEqual(blockedWithoutKit.reasons, [FAST_TRAVEL_BLOCK_REASON.FIELD_KIT_REQUIRED]);
assert.equal(blockedWithoutKit.distanceKm, 3.48);
assert.match(buildFastTravelRequestText(blockedWithoutKit), /Hızlı seyahat: KİLİTLİ/);
assert.match(buildFastTravelRequestText(blockedWithoutKit), /Sefer Bakım Kiti gerekli/);

assert.equal(grant(inventory, FIELD_READINESS_ITEMS.FIELD_RATION), true);
const rationOnly = inventory.snapshot();
assert.equal(rationOnly.fieldReadiness.tier, FIELD_READINESS_TIER.UNPREPARED);
assert.equal(rationOnly.fieldReadiness.score, 15);
assert.equal(rationOnly.fieldReadiness.capabilities.campProvisioning, false);

assert.equal(grant(inventory, FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK), true);
const provisioned = inventory.snapshot();
assert.equal(provisioned.fieldReadiness.tier, FIELD_READINESS_TIER.PROVISIONED);
assert.equal(provisioned.fieldReadiness.score, 50);
assert.equal(provisioned.fieldReadiness.capabilities.campProvisioning, true);
assert.equal(provisioned.fieldReadiness.capabilities.equipmentMaintenance, false);
assert.equal(provisioned.fieldReadiness.capabilities.fastTravelEligible, false);
assert.deepEqual(provisioned.fieldReadiness.missingForExpedition, [FIELD_READINESS_ITEMS.WHETSTONE]);

assert.equal(grant(inventory, FIELD_READINESS_ITEMS.WHETSTONE), true);
const maintained = inventory.snapshot();
assert.equal(maintained.fieldReadiness.tier, FIELD_READINESS_TIER.MAINTAINED);
assert.equal(maintained.fieldReadiness.score, 75);
assert.equal(maintained.fieldReadiness.capabilities.campProvisioning, true);
assert.equal(maintained.fieldReadiness.capabilities.equipmentMaintenance, true);
assert.equal(maintained.fieldReadiness.capabilities.fastTravelEligible, false);
assert.deepEqual(maintained.fieldReadiness.missingForExpedition, []);

const expeditionRecipe = QUARTERMASTER_OFFERS[1].fulfillment.craftUpgrade;
const availability = evaluateCraftAvailability(expeditionRecipe, maintained, INTERACTION_ITEMS);
assert.equal(availability.status, 'ready');
assert.equal(availability.ready, true);
assert.equal(availability.outputItemId, FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT);
assert.equal(availability.outputCapacity, 1);
assert.deepEqual(availability.inputs.map(({ itemId, requiredQuantity, availableQuantity, missingQuantity }) => ({
	itemId,
	requiredQuantity,
	availableQuantity,
	missingQuantity,
})), [
	{ itemId: FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, requiredQuantity: 1, availableQuantity: 1, missingQuantity: 0 },
	{ itemId: FIELD_READINESS_ITEMS.WHETSTONE, requiredQuantity: 1, availableQuantity: 1, missingQuantity: 0 },
]);

const duplicateRecipe = {
	recipeId: 'duplicate-readiness-fixture',
	inputs: [
		{ itemId: FIELD_READINESS_ITEMS.FIELD_RATION, quantity: 1 },
		{ itemId: FIELD_READINESS_ITEMS.FIELD_RATION, quantity: 2 },
	],
	outputItemId: FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK,
	outputQuantity: 1,
};
const duplicateMissing = evaluateCraftAvailability(duplicateRecipe, maintained, INTERACTION_ITEMS);
assert.equal(duplicateMissing.status, 'missing-inputs');
assert.equal(duplicateMissing.inputs.length, 1);
assert.equal(duplicateMissing.inputs[0].requiredQuantity, 3);
assert.equal(duplicateMissing.inputs[0].availableQuantity, 1);
assert.equal(duplicateMissing.inputs[0].missingQuantity, 2);

assert.equal(inventory.consume(FIELD_READINESS_ITEMS.FIELD_RATION, 1), true);
const noRation = inventory.snapshot();
const duplicateStillMissing = evaluateCraftAvailability(duplicateRecipe, noRation, INTERACTION_ITEMS);
assert.equal(duplicateStillMissing.inputs[0].availableQuantity, 0);
assert.equal(duplicateStillMissing.inputs[0].missingQuantity, 3);

const crafted = inventory.grant(FIELD_READINESS_ITEMS.WHETSTONE, 1, {
	sourceType: 'settlement-service',
	sourceId: 'dragonstone-watch-armorer-honing',
	craftUpgrade: expeditionRecipe,
});
assert.equal(crafted.ok, true);
assert.equal(crafted.crafted, true);
assert.deepEqual(crafted.consumedItems, [
	{ itemId: FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK, quantity: 1 },
	{ itemId: FIELD_READINESS_ITEMS.WHETSTONE, quantity: 1 },
]);

const ready = inventory.snapshot();
assert.equal(item(ready, FIELD_READINESS_ITEMS.TRAVEL_RATION_PACK), null);
assert.equal(item(ready, FIELD_READINESS_ITEMS.WHETSTONE), null);
assert.equal(item(ready, FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT)?.quantity, 1);
assert.equal(ready.fieldReadiness.tier, FIELD_READINESS_TIER.EXPEDITION_READY);
assert.equal(ready.fieldReadiness.score, 100);
assert.deepEqual(ready.fieldReadiness.equipped, {
	slot: 'field-kit',
	itemId: FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT,
});
assert.deepEqual(ready.fieldReadiness.capabilities, {
	campProvisioning: true,
	equipmentMaintenance: true,
	fastTravelEligible: true,
	survivalBuffer: true,
});
assert.deepEqual(ready.fieldReadiness.missingForExpedition, []);

const travelReady = evaluateFastTravelRequest(ready, {
	destinationId: 'dragonstone-harbor',
	discovered: true,
	routeOpen: true,
	inCombat: false,
	distanceKm: 3.476,
});
assert.equal(travelReady.allowed, true);
assert.equal(travelReady.status, 'ready');
assert.equal(travelReady.destinationId, 'dragonstone-harbor');
assert.equal(travelReady.distanceKm, 3.48);
assert.deepEqual(travelReady.reasons, []);
assert.match(buildFastTravelRequestText(travelReady), /HAZIR · dragonstone-harbor · 3.48 km/);

const travelBlockedByWorld = evaluateFastTravelRequest(ready.fieldReadiness, {
	destinationId: 'dragonstone-clifftop',
	discovered: false,
	routeOpen: false,
	inCombat: true,
});
assert.equal(travelBlockedByWorld.allowed, false);
assert.deepEqual(travelBlockedByWorld.reasons, [
	FAST_TRAVEL_BLOCK_REASON.UNDISCOVERED_DESTINATION,
	FAST_TRAVEL_BLOCK_REASON.COMBAT_ACTIVE,
	FAST_TRAVEL_BLOCK_REASON.ROUTE_BLOCKED,
]);
const blockedWorldText = buildFastTravelRequestText(travelBlockedByWorld);
assert.match(blockedWorldText, /hedef henüz keşfedilmedi/);
assert.match(blockedWorldText, /çatışma sürüyor/);
assert.match(blockedWorldText, /rota şu anda kapalı/);

const readinessText = buildFieldReadinessText(ready.fieldReadiness);
assert.match(readinessText, /Sefer hazırlığı: SEFERE HAZIR · 100\/100/);
assert.match(readinessText, /Saha ekipmanı: Dragonstone Sefer Bakım Kiti · field-kit/);
assert.match(readinessText, /hızlı seyahat hazırlığı/);
assert.match(readinessText, /sefer dayanıklılığı/);
const inventoryText = buildInventoryText(ready);
assert.match(inventoryText, /SEFERE HAZIR/);
assert.match(inventoryText, /Dragonstone Sefer Bakım Kiti/);
assert.match(inventoryText, /Kaynak: settlement-crafting\/dragonstone-expedition-maintenance-kit/);

const outputFull = evaluateCraftAvailability(expeditionRecipe, ready, INTERACTION_ITEMS);
assert.equal(outputFull.status, 'missing-inputs');
assert.equal(outputFull.ready, false);
assert.equal(outputFull.outputCapacity, 0);

const forged = structuredClone(ready);
forged.fieldReadiness = {
	tier: 'forged-ready',
	label: 'SAHTE',
	score: 999,
	equipped: { slot: 'god-mode', itemId: 'forged-item' },
};
forged.items.push({ itemId: 'future-cheat-item', quantity: 999, provenance: [] });
const restored = createInteractionInventoryState();
restored.restore(forged);
const roundTrip = restored.snapshot();
assert.equal(roundTrip.fieldReadiness.tier, FIELD_READINESS_TIER.EXPEDITION_READY);
assert.equal(roundTrip.fieldReadiness.score, 100);
assert.equal(item(roundTrip, 'future-cheat-item'), null);
assert.deepEqual(roundTrip.fieldReadiness.equipped, {
	slot: 'field-kit',
	itemId: FIELD_READINESS_ITEMS.EXPEDITION_MAINTENANCE_KIT,
});
assert.deepEqual(roundTrip.items, ready.items);

const restoredTravel = evaluateFastTravelRequest(roundTrip, {
	destinationId: 'dragonstone-harbor',
	discovered: true,
	routeOpen: true,
});
assert.equal(restoredTravel.allowed, true);
assert.equal(restoredTravel.readinessTier, FIELD_READINESS_TIER.EXPEDITION_READY);

const pureRoundTrip = evaluateFieldReadiness(roundTrip);
assert.deepEqual(pureRoundTrip, roundTrip.fieldReadiness);

console.log('[RPG] PASS interaction field readiness, derived equipment, fast travel contract, recipe UX, and forged-state rejection');
