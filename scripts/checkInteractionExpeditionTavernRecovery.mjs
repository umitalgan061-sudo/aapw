#!/usr/bin/env node
import assert from 'node:assert/strict';
import { EXPEDITION_BOARD_ROUTES } from '../src/3d/gameplay/interaction.js';
import {
	createInteractionInventoryState,
	createInteractionJourneyState,
} from '../src/3d/gameplay/interactionConfig.js';

const route = EXPEDITION_BOARD_ROUTES.find((entry) => entry.id === 'dragonstone-harbor-tavern-run');
assert.ok(route, 'canonical Dragonstone harbor tavern expedition must exist');
assert.equal(route.steps.length, 3);
assert.equal(route.steps[0].type, 'travel');
assert.equal(route.steps[1].type, 'rest');
assert.equal(route.steps[1].kind, 'tavern');
assert.equal(route.steps[1].siteId, 'dragonstone-harbor-tavern');
assert.equal(route.steps[2].type, 'travel');

const inventory = createInteractionInventoryState();
assert.equal(inventory.grant('dragonstone-expedition-maintenance-kit', 1, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-expedition-maintenance-kit',
}), true);
assert.equal(inventory.grant('dragonstone-travel-ration-pack', 2, {
	sourceType: 'settlement-crafting',
	sourceId: 'dragonstone-watch-travel-ration-pack',
}), true);

const before = inventory.snapshot();
assert.equal(before.fieldReadiness.capabilities.fastTravelEligible, true);
assert.equal(before.fieldReadiness.travelCapacity.travelRationPacks, 2);

const committed = inventory.commitJourneyWithRestStops(route.steps, { startingFatigueKm: 0 });
assert.equal(committed.ok, true);
assert.equal(committed.reason, 'committed');
assert.equal(committed.plan.complete, true);
assert.equal(committed.plan.totalDistanceKm, 58);
assert.equal(committed.plan.steps[0].fatigueAfterKm, 28);
assert.equal(committed.plan.steps[1].fatigueBeforeKm, 28);
assert.equal(committed.plan.steps[1].fatigueAfterKm, 0, 'tavern rest must fully recover carried fatigue');
assert.equal(committed.plan.steps[2].fatigueAfterKm, 30);
assert.equal(committed.plan.finalFatigueKm, 30);
assert.equal(committed.consumedQuantity, 2);
assert.equal(inventory.quantityOf('dragonstone-travel-ration-pack'), 0);
assert.equal(inventory.quantityOf('dragonstone-expedition-maintenance-kit'), 1, 'field kit must survive expedition travel');

const journey = createInteractionJourneyState();
assert.equal(journey.applyCommit(committed), true);
const journeySnapshot = journey.snapshot();
assert.equal(journeySnapshot.commitCount, 1);
assert.equal(journeySnapshot.fatigueKm, 30);
assert.equal(journeySnapshot.lastDestinationId, 'dragonstone-harbor-road');
assert.deepEqual(journeySnapshot.recentReceipts, [{
	sequence: 1,
	totalDistanceKm: 58,
	consumedTravelPacks: 2,
	finalFatigueKm: 30,
	destinationId: 'dragonstone-harbor-road',
	restStopCount: 1,
}]);

const savedInventory = inventory.snapshot();
const savedJourney = journey.snapshot();
const restoredInventory = createInteractionInventoryState();
const restoredJourney = createInteractionJourneyState();
restoredInventory.restore(savedInventory);
restoredJourney.restore(savedJourney);

assert.deepEqual(restoredInventory.snapshot(), savedInventory, 'inventory must round-trip after tavern expedition');
assert.deepEqual(restoredJourney.snapshot(), savedJourney, 'journey receipt/fatigue must round-trip after tavern expedition');
assert.equal(restoredInventory.snapshot().fieldReadiness.tier, 'expedition-ready');
assert.equal(restoredInventory.snapshot().fieldReadiness.travelCapacity.travelRationPacks, 0);

console.log('PASS: canonical harbor tavern expedition recovers mid-route fatigue, consumes provisions, preserves field kit, records journey receipt, and survives save/load');
