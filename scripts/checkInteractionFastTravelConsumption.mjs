import assert from 'node:assert/strict';
import { createInteractionInventoryState } from '../src/3d/gameplay/interactionConfig.js';
import { FAST_TRAVEL_BLOCK_REASON } from '../src/3d/gameplay/interactionFieldReadiness.js';

function inventoryWith(...entries) {
	const inventory = createInteractionInventoryState();
	for (const [itemId, quantity, provenance] of entries) {
		const granted = inventory.grant(itemId, quantity, provenance ?? { sourceType: 'test', sourceId: itemId });
		assert.equal(Boolean(granted), true, `failed to seed ${itemId}`);
	}
	return inventory;
}

const noKit = inventoryWith(['dragonstone-travel-ration-pack', 2]);
const noKitBefore = noKit.snapshot();
const noKitResult = noKit.consumeFastTravelProvisions({ distanceKm: 8 });
assert.equal(noKitResult.ok, false);
assert.equal(noKitResult.reason, FAST_TRAVEL_BLOCK_REASON.FIELD_KIT_REQUIRED);
assert.deepEqual(noKit.snapshot(), noKitBefore, 'missing-kit denial must not mutate inventory');

const kitOnly = inventoryWith(['dragonstone-expedition-maintenance-kit', 1]);
const emergencyBefore = kitOnly.snapshot();
const emergency = kitOnly.consumeFastTravelProvisions({ distanceKm: 12 });
assert.equal(emergency.ok, true);
assert.equal(emergency.consumedItemId, null);
assert.equal(emergency.consumedQuantity, 0);
assert.deepEqual(kitOnly.snapshot(), emergencyBefore, 'base field-kit range must consume no travel pack');

const emergencyOverflowBefore = kitOnly.snapshot();
const emergencyOverflow = kitOnly.consumeFastTravelProvisions({ distanceKm: 12.01 });
assert.equal(emergencyOverflow.ok, false);
assert.equal(emergencyOverflow.reason, FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS);
assert.equal(emergencyOverflow.routePlan.requiredTravelPacks, 1);
assert.equal(emergencyOverflow.routePlan.provisionShortfall, 1);
assert.deepEqual(kitOnly.snapshot(), emergencyOverflowBefore);

const onePack = inventoryWith(
	['dragonstone-expedition-maintenance-kit', 1],
	['dragonstone-travel-ration-pack', 1],
);
const onePackBefore = onePack.snapshot();
const onePackResult = onePack.consumeFastTravelProvisions({ distanceKm: 28 });
assert.equal(onePackResult.ok, true);
assert.equal(onePackResult.consumedItemId, 'dragonstone-travel-ration-pack');
assert.equal(onePackResult.consumedQuantity, 1);
assert.equal(onePackResult.routePlan.requiredTravelPacks, 1);
assert.equal(onePack.quantityOf('dragonstone-travel-ration-pack'), 0);
assert.equal(onePack.quantityOf('dragonstone-expedition-maintenance-kit'), 1);
assert.equal(onePackResult.inventory.fieldReadiness.tier, 'expedition-ready');
assert.equal(onePackResult.inventory.fieldReadiness.travelCapacity.maxDistanceKm, 12);
assert.equal(
	Number((onePackBefore.totalWeightKg - onePackResult.inventory.totalWeightKg).toFixed(2)),
	0.6,
	'travel consumption must update canonical carried weight',
);

const twoPacks = inventoryWith(
	['dragonstone-expedition-maintenance-kit', 1],
	['dragonstone-travel-ration-pack', 2],
);
const twoPackResult = twoPacks.consumeFastTravelProvisions({ distanceKm: 47.9 });
assert.equal(twoPackResult.ok, true);
assert.equal(twoPackResult.consumedQuantity, 2);
assert.equal(twoPacks.quantityOf('dragonstone-travel-ration-pack'), 0);
assert.equal(twoPackResult.inventory.fieldReadiness.travelCapacity.maxDistanceKm, 12);

const twoPackOverflow = inventoryWith(
	['dragonstone-expedition-maintenance-kit', 1],
	['dragonstone-travel-ration-pack', 2],
);
const overflowBefore = twoPackOverflow.snapshot();
const overflow = twoPackOverflow.consumeFastTravelProvisions({ distanceKm: 48.01 });
assert.equal(overflow.ok, false);
assert.equal(overflow.reason, FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS);
assert.equal(overflow.routePlan.requiredTravelPacks, 3);
assert.equal(overflow.routePlan.provisionShortfall, 1);
assert.deepEqual(twoPackOverflow.snapshot(), overflowBefore, 'under-provisioned travel must be atomic');

const zeroDistance = inventoryWith(
	['dragonstone-expedition-maintenance-kit', 1],
	['dragonstone-travel-ration-pack', 1],
);
const zeroBefore = zeroDistance.snapshot();
const zero = zeroDistance.consumeFastTravelProvisions({ distanceKm: 0 });
assert.equal(zero.ok, true);
assert.equal(zero.consumedQuantity, 0);
assert.deepEqual(zeroDistance.snapshot(), zeroBefore);

const restoreSource = inventoryWith(
	['dragonstone-expedition-maintenance-kit', 1],
	['dragonstone-travel-ration-pack', 2],
);
const saved = restoreSource.snapshot();
saved.fieldReadiness = {
	tier: 'forged',
	capabilities: { fastTravelEligible: true },
	travelCapacity: { maxDistanceKm: 9999, travelRationPacks: 9999 },
};
const restored = createInteractionInventoryState();
restored.restore(saved);
const canonical = restored.snapshot();
assert.equal(canonical.fieldReadiness.tier, 'expedition-ready');
assert.equal(canonical.fieldReadiness.travelCapacity.travelRationPacks, 2);
assert.equal(canonical.fieldReadiness.travelCapacity.maxDistanceKm, 48);
const restoredTrip = restored.consumeFastTravelProvisions({ distanceKm: 40 });
assert.equal(restoredTrip.ok, true);
assert.equal(restoredTrip.consumedQuantity, 2);
assert.equal(restored.quantityOf('dragonstone-travel-ration-pack'), 0);

const clamped = createInteractionInventoryState();
clamped.restore({
	items: [
		{ itemId: 'dragonstone-expedition-maintenance-kit', quantity: 999, provenance: [] },
		{ itemId: 'dragonstone-travel-ration-pack', quantity: 999, provenance: [] },
	],
});
assert.equal(clamped.quantityOf('dragonstone-expedition-maintenance-kit'), 1);
assert.equal(clamped.quantityOf('dragonstone-travel-ration-pack'), 2);
assert.equal(clamped.snapshot().fieldReadiness.travelCapacity.maxDistanceKm, 48);

console.log('PASS atomic fast travel provision consumption + restore integrity');
