#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	FAST_TRAVEL_BLOCK_REASON,
	buildExpeditionJourneyOptionsText,
	buildExpeditionJourneyText,
	evaluateExpeditionJourney,
	evaluateFieldReadiness,
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
assert.equal(underProvisioned.status, 'blocked');
assert.equal(underProvisioned.blockedAtLegIndex, 2);
assert.equal(underProvisioned.plannedLegCount, 3);
assert.equal(underProvisioned.totalRequiredTravelPacks, 1);
assert.equal(underProvisioned.remainingTravelPacks, 0);
assert.equal(underProvisioned.legs[2].allowed, false);
assert.deepEqual(underProvisioned.legs[2].reasons, [FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS]);
assert.equal(underProvisioned.legs[2].remainingTravelPacksBefore, 0);
assert.equal(underProvisioned.legs[2].remainingTravelPacksAfter, 0);
assert.match(buildExpeditionJourneyText(underProvisioned), /Rota tamamlanamadı · 3\. etapta durdu/);

const undiscovered = evaluateExpeditionJourney(inventoryWith({ travelPacks: 2 }), [threeLegs[0], { ...threeLegs[1], discovered: false }, threeLegs[2]]);
assert.equal(undiscovered.complete, false);
assert.equal(undiscovered.blockedAtLegIndex, 1);
assert.equal(undiscovered.plannedLegCount, 2, 'planner must stop after first blocked leg');
assert.deepEqual(undiscovered.legs[1].reasons, [FAST_TRAVEL_BLOCK_REASON.UNDISCOVERED_DESTINATION]);
assert.equal(undiscovered.remainingTravelPacks, 2, 'blocked leg cannot reserve or consume provisions');
assert.match(buildExpeditionJourneyText(undiscovered), /hedef henüz keşfedilmedi/);

const combatBlocked = evaluateExpeditionJourney(inventoryWith({ travelPacks: 2 }), [{ ...threeLegs[0], inCombat: true }]);
assert.equal(combatBlocked.complete, false);
assert.equal(combatBlocked.blockedAtLegIndex, 0);
assert.deepEqual(combatBlocked.legs[0].reasons, [FAST_TRAVEL_BLOCK_REASON.COMBAT_ACTIVE]);
const routeBlocked = evaluateExpeditionJourney(inventoryWith({ travelPacks: 2 }), [{ ...threeLegs[0], routeOpen: false }]);
assert.deepEqual(routeBlocked.legs[0].reasons, [FAST_TRAVEL_BLOCK_REASON.ROUTE_BLOCKED]);
const noKit = evaluateExpeditionJourney(inventoryWith({ kits: 0, travelPacks: 2 }), [threeLegs[0]]);
assert.equal(noKit.complete, false);
assert.deepEqual(noKit.legs[0].reasons, [FAST_TRAVEL_BLOCK_REASON.FIELD_KIT_REQUIRED]);
assert.equal(noKit.legs[0].requiredTravelPacks, 1, 'route cost remains visible even when field-kit authorization blocks consumption');
assert.equal(noKit.startingTravelPacks, 2, 'planner reports physical travel packs even when field-kit authorization is absent');
assert.equal(noKit.remainingTravelPacks, 2, 'blocked no-kit plan must not consume physical travel packs');
assert.equal(noKit.legs[0].remainingTravelPacksBefore, 2);
assert.equal(noKit.legs[0].remainingTravelPacksAfter, 2, 'authorization failure must preserve route provisions atomically');

const malformed = evaluateExpeditionJourney(evaluateFieldReadiness(inventoryWith({ travelPacks: 2 })), [{ originId: 'dragonstone', destinationId: '  ', discovered: true, routeOpen: true, distanceKm: -5 }]);
assert.equal(malformed.complete, false);
assert.equal(malformed.legs[0].destinationId, null);
assert.equal(malformed.legs[0].distanceKm, null);
assert.deepEqual(malformed.legs[0].reasons, [FAST_TRAVEL_BLOCK_REASON.NO_DESTINATION]);
const empty = evaluateExpeditionJourney(inventoryWith({ travelPacks: 2 }), []);
assert.equal(empty.complete, false);
assert.equal(empty.plannedLegCount, 0);
assert.equal(buildExpeditionJourneyText(empty), 'Sefer Rotası\nHenüz rota planlanmadı.');
const capped = evaluateExpeditionJourney(inventoryWith({ travelPacks: 99 }), [{ originId: 'dragonstone', destinationId: 'far-road', discovered: true, routeOpen: true, inCombat: false, distanceKm: 85 }]);
assert.equal(capped.complete, false);
assert.deepEqual(capped.legs[0].reasons, [FAST_TRAVEL_BLOCK_REASON.INSUFFICIENT_PROVISIONS]);

const routeOptions = rankExpeditionJourneyOptions(readySnapshot, [
	{ id: 'shore', label: 'Sahil yolu', legs: [{ originId: 'dragonstone', destinationId: 'harbor', discovered: true, routeOpen: true, distanceKm: 42 }] },
	{ id: 'ridge', label: 'Sırt yolu', legs: [{ originId: 'dragonstone', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 }] },
	{ id: 'closed-pass', label: 'Kapalı geçit', legs: [{ originId: 'dragonstone', destinationId: 'pass', discovered: true, routeOpen: false, distanceKm: 8 }] },
]);
assert.equal(routeOptions.preferredRouteId, 'ridge');
assert.equal(routeOptions.preferred.label, 'Sırt yolu');
assert.deepEqual(routeOptions.options.map((entry) => entry.id), ['ridge', 'shore', 'closed-pass']);
assert.equal(routeOptions.options[0].totalRequiredTravelPacks, 1);
assert.equal(routeOptions.options[1].totalRequiredTravelPacks, 2);
assert.equal(routeOptions.options[2].complete, false);
const optionsText = buildExpeditionJourneyOptionsText(routeOptions);
assert.match(optionsText, /1\. Sırt yolu · ÖNERİ · HAZIR · 28 km · 1 azık/);
assert.match(optionsText, /2\. Sahil yolu · ADAY · HAZIR · 42 km · 2 azık/);
assert.match(optionsText, /Önerilen rota: Sırt yolu/);

const tieBreak = rankExpeditionJourneyOptions(readySnapshot, [
	{ id: 'beta', legs: [{ destinationId: 'b', discovered: true, routeOpen: true, distanceKm: 10 }] },
	{ id: 'alpha', legs: [{ destinationId: 'a', discovered: true, routeOpen: true, distanceKm: 10 }] },
]);
assert.deepEqual(tieBreak.options.map((entry) => entry.id), ['alpha', 'beta'], 'equal routes use stable id ordering');
const noValid = rankExpeditionJourneyOptions(inventoryWith({ kits: 0, travelPacks: 2 }), [{ id: 'a', legs: threeLegs }]);
assert.equal(noValid.preferredRouteId, null);
assert.match(buildExpeditionJourneyOptionsText(noValid), /Uygun rota bulunamadı/);

console.log(`[RPG] PASS sequential expedition journey planning ${JSON.stringify({ ready: { distanceKm: readyPlan.totalDistanceKm, provisions: readyPlan.totalRequiredTravelPacks }, preferredRoute: routeOptions.preferredRouteId, blockedAt: underProvisioned.blockedAtLegIndex })}`);
