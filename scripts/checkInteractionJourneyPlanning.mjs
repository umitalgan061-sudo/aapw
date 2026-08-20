#!/usr/bin/env node
import assert from 'node:assert/strict';
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
assert.equal(withTavern.steps[1].fatigueAfterKm, 0);
assert.equal(withTavern.finalFatigueKm, 30);
assert.match(buildJourneyRestText(withTavern), /Taverna · watch-road-tavern · DİNLENDİ/);
assert.match(buildJourneyRestText(withTavern), /Plan hazır · son yorgunluk: 30 km/);

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

console.log(`[RPG] PASS sequential expedition journey + tavern rest planning ${JSON.stringify({ readyDistanceKm: readyPlan.totalDistanceKm, preferredRoute: routeOptions.preferredRouteId, enduranceKm: endurance.continuousDistanceKm, tavernJourneyKm: withTavern.totalDistanceKm })}`);
