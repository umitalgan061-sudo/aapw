import assert from 'node:assert/strict';
import { createInteractionInventoryState } from '../src/3d/gameplay/interactionConfig.js';
import {
	FAST_TRAVEL_BLOCK_REASON,
	evaluateFastTravelRequest,
} from '../src/3d/gameplay/interactionFieldReadiness.js';

const inventory = createInteractionInventoryState();
assert.equal(inventory.grant('dragonstone-expedition-maintenance-kit', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-expedition-maintenance-kit',
}), true);
assert.equal(inventory.grant('dragonstone-travel-ration-pack', 2, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}), true);

const original = inventory.snapshot();
assert.equal(original.fieldReadiness.travelCapacity.maxDistanceKm, 48);
assert.equal(original.totalWeightKg, 2.05);

const firstDecision = evaluateFastTravelRequest(original, {
	destinationId: 'dragonstone-outer-watch',
	discovered: true,
	routeOpen: true,
	inCombat: false,
	distanceKm: 28,
});
assert.equal(firstDecision.allowed, true);
assert.equal(firstDecision.routePlan.requiredTravelPacks, 1);

const firstTravel = inventory.consumeFastTravelProvisions({ distanceKm: 28 });
assert.equal(firstTravel.ok, true);
assert.equal(firstTravel.consumedQuantity, 1);
assert.equal(firstTravel.inventory.fieldReadiness.travelCapacity.maxDistanceKm, 30);
assert.equal(firstTravel.inventory.totalWeightKg, 1.45);

const secondDecision = evaluateFastTravelRequest(firstTravel.inventory, {
	destinationId: 'dragonstone-harbor',
	discovered: true,
	routeOpen: true,
	inCombat: false,
	distanceKm: 29.5,
});
assert.equal(secondDecision.allowed, true);
assert.equal(secondDecision.routePlan.requiredTravelPacks, 1);

const persistedAfterOneTrip = structuredClone(firstTravel.inventory);
persistedAfterOneTrip.fieldReadiness = {
	tier: 'expedition-ready',
	score: 100,
	capabilities: { fastTravelEligible: true },
	travelCapacity: {
		travelRationPacks: 2,
		baseRangeKm: 12,
		rationRangeKm: 36,
		maxDistanceKm: 48,
	},
};

const restored = createInteractionInventoryState();
restored.restore(persistedAfterOneTrip);
const canonicalAfterRestore = restored.snapshot();
assert.equal(canonicalAfterRestore.fieldReadiness.travelCapacity.travelRationPacks, 1);
assert.equal(canonicalAfterRestore.fieldReadiness.travelCapacity.maxDistanceKm, 30);
assert.equal(canonicalAfterRestore.totalWeightKg, 1.45);

const secondTravel = restored.consumeFastTravelProvisions({ distanceKm: 29.5 });
assert.equal(secondTravel.ok, true);
assert.equal(secondTravel.consumedQuantity, 1);
assert.equal(secondTravel.inventory.fieldReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(secondTravel.inventory.fieldReadiness.travelCapacity.maxDistanceKm, 12);
assert.equal(secondTravel.inventory.totalWeightKg, 0.85);
assert.equal(restored.quantityOf('dragonstone-expedition-maintenance-kit'), 1);

const nowTooFarBefore = restored.snapshot();
const nowTooFar = restored.consumeFastTravelProvisions({ distanceKm: 12.1 });
assert.equal(nowTooFar.ok, false);
assert.equal(nowTooFar.reason, FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS);
assert.deepEqual(restored.snapshot(), nowTooFarBefore);

const zeroTrip = restored.consumeFastTravelProvisions({ distanceKm: 0 });
assert.equal(zeroTrip.ok, true);
assert.equal(zeroTrip.consumedQuantity, 0);
assert.deepEqual(restored.snapshot(), nowTooFarBefore);

const forgedSave = {
	items: [
		{
			itemId: 'dragonstone-expedition-maintenance-kit',
			name: 'Forged Kit',
			rarity: 'legendary',
			weightKg: 0,
			quantity: 500,
			provenance: [{ sourceType: 'quest', sourceId: 'forged' }],
		},
		{
			itemId: 'dragonstone-travel-ration-pack',
			name: 'Infinite Food',
			rarity: 'legendary',
			weightKg: 0,
			quantity: 500,
			provenance: [{ sourceType: 'quest', sourceId: 'forged' }],
		},
		{ itemId: 'unknown-route-token', quantity: 999, provenance: [] },
	],
	fieldReadiness: { travelCapacity: { maxDistanceKm: 99999 } },
};
const hardened = createInteractionInventoryState();
hardened.restore(forgedSave);
const hardenedSnapshot = hardened.snapshot();
assert.equal(hardened.quantityOf('dragonstone-expedition-maintenance-kit'), 1);
assert.equal(hardened.quantityOf('dragonstone-travel-ration-pack'), 2);
assert.equal(hardened.quantityOf('unknown-route-token'), 0);
assert.equal(hardenedSnapshot.totalWeightKg, 2.05);
assert.equal(hardenedSnapshot.fieldReadiness.travelCapacity.maxDistanceKm, 48);
assert.equal(hardenedSnapshot.items.find((entry) => entry.itemId === 'dragonstone-travel-ration-pack')?.name, 'Dragonstone Yol Azığı Paketi');
assert.equal(hardenedSnapshot.items.find((entry) => entry.itemId === 'dragonstone-travel-ration-pack')?.weightKg, 0.6);

const hardenedDecision = evaluateFastTravelRequest(hardenedSnapshot, {
	destinationId: 'dragonstone-long-road',
	discovered: true,
	routeOpen: true,
	inCombat: false,
	distanceKm: 47.99,
});
assert.equal(hardenedDecision.allowed, true);
assert.equal(hardenedDecision.routePlan.requiredTravelPacks, 2);

console.log('PASS route provision persistence + canonical save restore');
