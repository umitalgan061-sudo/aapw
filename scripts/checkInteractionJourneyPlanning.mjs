#!/usr/bin/env node
import assert from 'node:assert/strict';
import { buildJourneyStateText, createInteractionInventoryState, createInteractionJourneyState } from '../src/3d/gameplay/interactionConfig.js';
import {
	FAST_TRAVEL_BLOCK_REASON,
	JOURNEY_REST_BLOCK_REASON,
	REST_KIND,
	buildExpeditionJourneyOptionsText,
	buildExpeditionJourneyText,
	buildJourneyRestText,
	evaluateExpeditionJourney,
	evaluateFieldReadiness,
	evaluateJourneyEndurance,
	evaluateJourneyWithRestStops,
	evaluateRestRequest,
	rankExpeditionJourneyOptions,
} from '../src/3d/gameplay/interactionFieldReadiness.js';

function inventoryWith({ kits = 1, travelPacks = 0 } = {}) {
	const items = [];
	if (kits > 0) items.push({ itemId: 'dragonstone-expedition-maintenance-kit', quantity: kits });
	if (travelPacks > 0) items.push({ itemId: 'dragonstone-travel-ration-pack', quantity: travelPacks });
	return { items };
}

const threeLegs = [
	{ originId: 'dragonstone', destinationId: 'dragonstone-watch-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 10 },
	{ originId: 'dragonstone-watch-road', destinationId: 'dragonstone-harbor-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 25 },
	{ originId: 'dragonstone-harbor-road', destinationId: 'dragonstone', discovered: true, routeOpen: true, inCombat: false, distanceKm: 20 },
];

const readySnapshot = inventoryWith({ travelPacks: 2 });
const readyBefore = structuredClone(readySnapshot);
const readyPlan = evaluateExpeditionJourney(readySnapshot, threeLegs);
assert.equal(readyPlan.complete, true);
assert.equal(readyPlan.status, 'ready');
assert.equal(readyPlan.plannedLegCount, 3);
assert.equal(readyPlan.authoredLegCount, 3);
assert.equal(readyPlan.blockedAtLegIndex, null);
assert.equal(readyPlan.totalDistanceKm, 55);
assert.equal(readyPlan.totalRequiredTravelPacks, 2);
assert.equal(readyPlan.startingTravelPacks, 2);
assert.equal(readyPlan.remainingTravelPacks, 0);
assert.deepEqual(readySnapshot, readyBefore, 'journey planning must stay side-effect free');
assert.deepEqual(readyPlan.legs.map((leg) => ({ index: leg.index, allowed: leg.allowed, required: leg.requiredTravelPacks, before: leg.remainingTravelPacksBefore, after: leg.remainingTravelPacksAfter })), [
	{ index: 0, allowed: true, required: 0, before: 2, after: 2 },
	{ index: 1, allowed: true, required: 1, before: 2, after: 1 },
	{ index: 2, allowed: true, required: 1, before: 1, after: 0 },
]);

const readyText = buildExpeditionJourneyText(readyPlan);
assert.match(readyText, /^Sefer Rotası/m);
assert.match(readyText, /Toplam: 55 km · 2 yol azığı/);
assert.match(readyText, /1\. dragonstone → dragonstone-watch-road · 10 km · HAZIR · acil menzil/);
assert.match(readyText, /2\. dragonstone-watch-road → dragonstone-harbor-road · 25 km · HAZIR · 1 azık/);
assert.match(readyText, /Rota hazır · kalan yol azığı: 0/);

const underProvisioned = evaluateExpeditionJourney(inventoryWith({ travelPacks: 1 }), threeLegs);
assert.equal(underProvisioned.complete, false);
assert.equal(underProvisioned.blockedAtLegIndex, 2);
assert.equal(underProvisioned.remainingTravelPacks, 0);
assert.deepEqual(underProvisioned.legs[2].reasons, [FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS]);

const undiscovered = evaluateExpeditionJourney(inventoryWith({ travelPacks: 2 }), [threeLegs[0], { ...threeLegs[1], discovered: false }, threeLegs[2]]);
assert.equal(undiscovered.complete, false);
assert.equal(undiscovered.blockedAtLegIndex, 1);
assert.deepEqual(undiscovered.legs[1].reasons, [FAST_TRAVEL_BLOCK_REASON.UNDISCOVERED_DESTINATION]);
assert.equal(undiscovered.remainingTravelPacks, 2);

const combatBlocked = evaluateExpeditionJourney(inventoryWith({ travelPacks: 2 }), [{ ...threeLegs[0], inCombat: true }]);
assert.deepEqual(combatBlocked.legs[0].reasons, [FAST_TRAVEL_BLOCK_REASON.COMBAT_ACTIVE]);
const noKit = evaluateExpeditionJourney(inventoryWith({ kits: 0, travelPacks: 2 }), [threeLegs[0]]);
assert.deepEqual(noKit.legs[0].reasons, [FAST_TRAVEL_BLOCK_REASON.FIELD_KIT_REQUIRED]);
assert.equal(noKit.remainingTravelPacks, 2);

const routeOptions = rankExpeditionJourneyOptions(readySnapshot, [
	{ id: 'shore', label: 'Sahil yolu', legs: [{ originId: 'dragonstone', destinationId: 'harbor', discovered: true, routeOpen: true, distanceKm: 42 }] },
	{ id: 'ridge', label: 'Sırt yolu', legs: [{ originId: 'dragonstone', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 }] },
	{ id: 'closed-pass', label: 'Kapalı geçit', legs: [{ originId: 'dragonstone', destinationId: 'pass', discovered: true, routeOpen: false, distanceKm: 8 }] },
]);
assert.equal(routeOptions.preferredRouteId, 'ridge');
assert.deepEqual(routeOptions.options.map((entry) => entry.id), ['ridge', 'shore', 'closed-pass']);
assert.match(buildExpeditionJourneyOptionsText(routeOptions), /Önerilen rota: Sırt yolu/);

const tieBreak = rankExpeditionJourneyOptions(readySnapshot, [
	{ id: 'beta', legs: [{ destinationId: 'b', discovered: true, routeOpen: true, distanceKm: 10 }] },
	{ id: 'alpha', legs: [{ destinationId: 'a', discovered: true, routeOpen: true, distanceKm: 10 }] },
]);
assert.deepEqual(tieBreak.options.map((entry) => entry.id), ['alpha', 'beta']);

// Tavern/camp survival seam: same readiness snapshot, no second inventory or travel store.
const readyReadiness = evaluateFieldReadiness(readySnapshot);
const endurance = evaluateJourneyEndurance(readyReadiness);
assert.deepEqual(endurance, {
	continuousDistanceKm: 44,
	baseDistanceKm: 24,
	fieldKitBonusKm: 12,
	rationBufferKm: 8,
	travelRationPacks: 2,
	readinessTier: 'expedition-ready',
});

const tavern = evaluateRestRequest(readyReadiness, { kind: REST_KIND.TAVERN, siteId: 'dragonstone-harbor-tavern', discovered: true, open: true, fatigueKm: 31.5 });
assert.equal(tavern.allowed, true);
assert.equal(tavern.recoveredFatigueKm, 31.5);
assert.equal(tavern.remainingFatigueKm, 0);

const camp = evaluateRestRequest(readyReadiness, { kind: REST_KIND.CAMP, siteId: 'dragonstone-ridge-camp', open: true, fatigueKm: 20 });
assert.equal(camp.allowed, true);
assert.equal(camp.recoveredFatigueKm, 11);
assert.equal(camp.remainingFatigueKm, 9);

const blockedTavern = evaluateRestRequest(readyReadiness, { kind: REST_KIND.TAVERN, siteId: 'unknown-inn', discovered: false, open: false, inCombat: true, fatigueKm: 12 });
assert.deepEqual(blockedTavern.reasons, [
	JOURNEY_REST_BLOCK_REASON.REST_SITE_CLOSED,
	JOURNEY_REST_BLOCK_REASON.TAVERN_NOT_DISCOVERED,
	JOURNEY_REST_BLOCK_REASON.COMBAT_ACTIVE,
]);

const withTavern = evaluateJourneyWithRestStops(readyReadiness, [
	{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
	{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'watch-road-tavern', discovered: true, open: true },
	{ type: 'travel', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 30 },
]);
assert.equal(withTavern.complete, true);
assert.equal(withTavern.totalDistanceKm, 58);
assert.equal(withTavern.startingTravelPacks, 2);
assert.equal(withTavern.remainingTravelPacks, 0);
assert.equal(withTavern.steps[0].remainingTravelPacksAfter, 1);
assert.equal(withTavern.steps[1].remainingTravelPacksAfter, 1);
assert.equal(withTavern.steps[2].remainingTravelPacksBefore, 1);
assert.equal(withTavern.steps[2].remainingTravelPacksAfter, 0);
assert.equal(withTavern.steps[1].fatigueAfterKm, 0);
assert.equal(withTavern.finalFatigueKm, 30);
assert.match(buildJourneyRestText(withTavern), /Taverna · watch-road-tavern · DİNLENDİ/);
assert.match(buildJourneyRestText(withTavern), /Plan hazır · son yorgunluk: 30 km · kalan yol azığı: 0/);

const onePackSnapshot = inventoryWith({ travelPacks: 1 });
const onePackBefore = structuredClone(onePackSnapshot);
const onePackReadiness = evaluateFieldReadiness(onePackSnapshot);
const provisionCarryBlocked = evaluateJourneyWithRestStops(onePackReadiness, [
	{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 30 },
	{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'watch-road-tavern', discovered: true, open: true },
	{ type: 'travel', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 30 },
]);
assert.equal(provisionCarryBlocked.complete, false);
assert.equal(provisionCarryBlocked.blockedAtStepIndex, 2);
assert.equal(provisionCarryBlocked.remainingTravelPacks, 0);
assert.equal(provisionCarryBlocked.steps[0].requiredTravelPacks, 1);
assert.equal(provisionCarryBlocked.steps[0].remainingTravelPacksAfter, 0);
assert.deepEqual(provisionCarryBlocked.steps[2].reasons, [FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS]);
assert.deepEqual(onePackSnapshot, onePackBefore, 'rest-enabled journey planning must not mutate inventory snapshots');

const exhausted = evaluateJourneyWithRestStops(readyReadiness, [
	{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
	{ type: 'travel', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 20 },
]);
assert.equal(exhausted.complete, false);
assert.equal(exhausted.blockedAtStepIndex, 1);
assert.deepEqual(exhausted.steps[1].reasons, [JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED]);
assert.equal(exhausted.finalFatigueKm, 28);

const partialCamp = evaluateJourneyWithRestStops(readyReadiness, [
	{ type: 'travel', destinationId: 'ridge', discovered: true, routeOpen: true, distanceKm: 30 },
	{ type: 'rest', kind: REST_KIND.CAMP, siteId: 'ridge-camp', open: true },
	{ type: 'travel', destinationId: 'harbor', discovered: true, routeOpen: true, distanceKm: 24 },
]);
assert.equal(partialCamp.complete, true);
assert.equal(partialCamp.steps[1].fatigueAfterKm, 13.5);
assert.equal(partialCamp.finalFatigueKm, 37.5);

const noCampCapability = evaluateRestRequest({ ...readyReadiness, capabilities: { ...readyReadiness.capabilities, campProvisioning: false } }, { kind: REST_KIND.CAMP, siteId: 'dry-camp', fatigueKm: 10 });
assert.deepEqual(noCampCapability.reasons, [JOURNEY_REST_BLOCK_REASON.CAMP_CAPABILITY_REQUIRED]);

const carriedFatigueBlocked = evaluateJourneyWithRestStops(readyReadiness, [
	{ type: 'travel', destinationId: 'next-watch', discovered: true, routeOpen: true, distanceKm: 15 },
], { startingFatigueKm: 30 });
assert.equal(carriedFatigueBlocked.complete, false);
assert.equal(carriedFatigueBlocked.startingFatigueKm, 30);
assert.deepEqual(carriedFatigueBlocked.steps[0].reasons, [JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED]);
assert.match(buildJourneyRestText(carriedFatigueBlocked), /Başlangıç yorgunluğu: 30 km/);

const carriedFatigueRested = evaluateJourneyWithRestStops(readyReadiness, [
	{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'next-watch-tavern', discovered: true, open: true },
	{ type: 'travel', destinationId: 'next-watch', discovered: true, routeOpen: true, distanceKm: 15 },
], { startingFatigueKm: 30 });
assert.equal(carriedFatigueRested.complete, true);
assert.equal(carriedFatigueRested.steps[0].fatigueBeforeKm, 30);
assert.equal(carriedFatigueRested.steps[0].fatigueAfterKm, 0);
assert.equal(carriedFatigueRested.finalFatigueKm, 15);

const journeyState = createInteractionJourneyState();
journeyState.restore({ fatigueKm: 999, commitCount: 9_999_999, lastDestinationId: '  forged-harbor  ' });
assert.deepEqual(journeyState.snapshot(), { fatigueKm: 52, commitCount: 1_000_000, lastDestinationId: 'forged-harbor', recentReceipts: [] });
journeyState.restore(null);
assert.deepEqual(journeyState.snapshot(), { fatigueKm: 0, commitCount: 0, lastDestinationId: null, recentReceipts: [] });

// Commit seam: the interaction-owned inventory applies the already-qualified plan as one transaction.
const journeySteps = [
	{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
	{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'watch-road-tavern', discovered: true, open: true },
	{ type: 'travel', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 30 },
];
const commitInventory = createInteractionInventoryState();
assert.equal(commitInventory.grant('dragonstone-expedition-maintenance-kit', 1, { sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }), true);
assert.equal(commitInventory.grant('dragonstone-travel-ration-pack', 2, { sourceType: 'settlement-crafting', sourceId: 'dragonstone-watch-travel-ration-pack' }), true);
const commitBefore = commitInventory.snapshot();
assert.equal(commitBefore.totalWeightKg, 2.05);
const committed = commitInventory.commitJourneyWithRestStops(journeySteps);
assert.equal(committed.ok, true);
assert.equal(committed.reason, 'committed');
assert.equal(committed.consumedItemId, 'dragonstone-travel-ration-pack');
assert.equal(committed.consumedQuantity, 2);
assert.equal(committed.plan.complete, true);
assert.equal(committed.plan.finalFatigueKm, 30);
assert.equal(committed.inventory.totalWeightKg, 0.85);
assert.equal(committed.inventory.fieldReadiness.tier, 'expedition-ready');
assert.equal(committed.inventory.fieldReadiness.travelCapacity.travelRationPacks, 0);
assert.equal(commitInventory.quantityOf('dragonstone-expedition-maintenance-kit'), 1);
assert.equal(commitInventory.quantityOf('dragonstone-travel-ration-pack'), 0);
assert.deepEqual(committed.inventory.items.find((item) => item.itemId === 'dragonstone-expedition-maintenance-kit')?.provenance, [{ sourceType: 'settlement-crafting', sourceId: 'dragonstone-expedition-maintenance-kit' }]);

assert.equal(journeyState.applyCommit(committed), true);
const firstJourneyReceipt = {
	sequence: 1,
	totalDistanceKm: 58,
	consumedTravelPacks: 2,
	finalFatigueKm: 30,
	destinationId: 'harbor-road',
	restStopCount: 1,
};
assert.deepEqual(journeyState.snapshot(), { fatigueKm: 30, commitCount: 1, lastDestinationId: 'harbor-road', recentReceipts: [firstJourneyReceipt] });
const committedReadiness = evaluateFieldReadiness(committed.inventory);
assert.match(buildJourneyStateText(journeyState.snapshot(), committedReadiness), /Sefer yorgunluğu: 30\/36 km/);
assert.match(buildJourneyStateText(journeyState.snapshot(), committedReadiness), /Kesintisiz kalan dayanıklılık: 6 km/);
assert.match(buildJourneyStateText(journeyState.snapshot(), committedReadiness), /Son sefer hedefi: harbor-road/);
assert.match(buildJourneyStateText(journeyState.snapshot(), committedReadiness), /Son sefer: 58 km · 2 yol azığı · 1 dinlenme/);
const receiptRoundTrip = createInteractionJourneyState();
receiptRoundTrip.restore(journeyState.snapshot());
assert.deepEqual(receiptRoundTrip.snapshot(), journeyState.snapshot(), 'journey receipt/fatigue must survive canonical restore');
const forgedReceiptState = createInteractionJourneyState();
forgedReceiptState.restore({
	fatigueKm: 9,
	commitCount: 7,
	lastDestinationId: ' final ',
	recentReceipts: Array.from({ length: 7 }, (_, index) => ({
		sequence: index + 1,
		totalDistanceKm: (index + 1) * 10,
		consumedTravelPacks: index + 1,
		finalFatigueKm: index === 6 ? 999 : index,
		destinationId: ` stop-${index + 1} `,
		restStopCount: index,
	})),
});
assert.deepEqual(forgedReceiptState.snapshot().recentReceipts.map((receipt) => receipt.sequence), [3, 4, 5, 6, 7], 'only the bounded last-five journey receipts survive restore');
assert.equal(forgedReceiptState.snapshot().recentReceipts.at(-1).finalFatigueKm, 52);
assert.equal(forgedReceiptState.snapshot().recentReceipts.at(-1).destinationId, 'stop-7');

const followupFatigueBlocked = commitInventory.commitJourneyWithRestStops([
	{ type: 'travel', destinationId: 'nearby-camp', discovered: true, routeOpen: true, distanceKm: 10 },
], { startingFatigueKm: committed.plan.finalFatigueKm });
assert.equal(followupFatigueBlocked.ok, false);
assert.equal(followupFatigueBlocked.reason, JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED);
assert.equal(followupFatigueBlocked.consumedQuantity, 0);

const restoredAfterJourney = createInteractionInventoryState();
restoredAfterJourney.restore(committed.inventory);
assert.deepEqual(restoredAfterJourney.snapshot(), committed.inventory, 'committed expedition inventory must survive canonical save/load');

const atomicBlocked = createInteractionInventoryState();
atomicBlocked.grant('dragonstone-expedition-maintenance-kit', 1, { sourceType: 'settlement-crafting', sourceId: 'kit' });
atomicBlocked.grant('dragonstone-travel-ration-pack', 1, { sourceType: 'settlement-crafting', sourceId: 'pack' });
const atomicBlockedBefore = atomicBlocked.snapshot();
const blockedCommit = atomicBlocked.commitJourneyWithRestStops([
	{ ...journeySteps[0], distanceKm: 30 },
	journeySteps[1],
	{ ...journeySteps[2], distanceKm: 30 },
]);
assert.equal(blockedCommit.ok, false);
assert.equal(blockedCommit.reason, FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS);
assert.equal(blockedCommit.blockedAtStepIndex, 2);
assert.equal(blockedCommit.consumedQuantity, 0);
assert.deepEqual(atomicBlocked.snapshot(), atomicBlockedBefore, 'blocked multi-step journey must consume no provisions');

const fatigueBlockedInventory = createInteractionInventoryState();
fatigueBlockedInventory.grant('dragonstone-expedition-maintenance-kit', 1, { sourceType: 'settlement-crafting', sourceId: 'kit' });
fatigueBlockedInventory.grant('dragonstone-travel-ration-pack', 2, { sourceType: 'settlement-crafting', sourceId: 'pack' });
const fatigueBlockedBefore = fatigueBlockedInventory.snapshot();
const fatigueCommit = fatigueBlockedInventory.commitJourneyWithRestStops([
	{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
	{ type: 'travel', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 20 },
]);
assert.equal(fatigueCommit.ok, false);
assert.equal(fatigueCommit.reason, JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED);
assert.equal(fatigueCommit.consumedQuantity, 0);
assert.deepEqual(fatigueBlockedInventory.snapshot(), fatigueBlockedBefore, 'fatigue-blocked journey must stay atomic');

const forgedCostInventory = createInteractionInventoryState();
forgedCostInventory.grant('dragonstone-expedition-maintenance-kit', 1, { sourceType: 'settlement-crafting', sourceId: 'kit' });
forgedCostInventory.grant('dragonstone-travel-ration-pack', 1, { sourceType: 'settlement-crafting', sourceId: 'pack' });
const forgedCostCommit = forgedCostInventory.commitJourneyWithRestStops([
	{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 30, requiredTravelPacks: 0, remainingTravelPacksAfter: 99 },
]);
assert.equal(forgedCostCommit.ok, true);
assert.equal(forgedCostCommit.consumedQuantity, 1, 'commit must recompute route cost instead of trusting caller-authored cost fields');
assert.equal(forgedCostInventory.quantityOf('dragonstone-travel-ration-pack'), 0);

console.log(`[RPG] PASS sequential expedition journey + tavern rest planning/commit ${JSON.stringify({ readyDistanceKm: readyPlan.totalDistanceKm, preferredRoute: routeOptions.preferredRouteId, enduranceKm: endurance.continuousDistanceKm, tavernJourneyKm: withTavern.totalDistanceKm, provisionCarryBlockedAt: provisionCarryBlocked.blockedAtStepIndex, committedPacks: committed.consumedQuantity, carriedFatigueKm: carriedFatigueBlocked.startingFatigueKm, recentReceipts: journeyState.snapshot().recentReceipts.length })}`);
