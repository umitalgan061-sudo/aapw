import assert from 'node:assert/strict';
import {
	JOURNEY_REST_BLOCK_REASON,
	REST_KIND,
	buildJourneyRestText,
	evaluateJourneyEndurance,
	evaluateJourneyWithRestStops,
	evaluateRestRequest,
} from '../src/3d/gameplay/interactionJourneyRest.js';

const expeditionReady = {
	tier: 'expedition-ready',
	capabilities: {
		fastTravelEligible: true,
		survivalBuffer: true,
		campProvisioning: true,
	},
	travelCapacity: {
		travelRationPacks: 2,
		baseRangeKm: 12,
		rationRangeKm: 36,
		maxDistanceKm: 48,
	},
};

const endurance = evaluateJourneyEndurance(expeditionReady);
assert.deepEqual(endurance, {
	continuousDistanceKm: 44,
	baseDistanceKm: 24,
	fieldKitBonusKm: 12,
	rationBufferKm: 8,
	travelRationPacks: 2,
	readinessTier: 'expedition-ready',
});

const tavernRest = evaluateRestRequest(expeditionReady, {
	kind: REST_KIND.TAVERN,
	siteId: 'dragonstone-harbor-tavern',
	discovered: true,
	open: true,
	inCombat: false,
	fatigueKm: 31.5,
});
assert.equal(tavernRest.allowed, true);
assert.equal(tavernRest.recoveredFatigueKm, 31.5);
assert.equal(tavernRest.remainingFatigueKm, 0);

const campRest = evaluateRestRequest(expeditionReady, {
	kind: REST_KIND.CAMP,
	siteId: 'dragonstone-ridge-camp',
	open: true,
	fatigueKm: 20,
});
assert.equal(campRest.allowed, true);
assert.equal(campRest.recoveredFatigueKm, 11);
assert.equal(campRest.remainingFatigueKm, 9);

const blockedCamp = evaluateRestRequest({
	...expeditionReady,
	capabilities: { ...expeditionReady.capabilities, campProvisioning: false },
}, {
	kind: REST_KIND.CAMP,
	siteId: 'dry-camp',
	fatigueKm: 20,
});
assert.deepEqual(blockedCamp.reasons, [JOURNEY_REST_BLOCK_REASON.CAMP_CAPABILITY_REQUIRED]);

const blockedTavern = evaluateRestRequest(expeditionReady, {
	kind: REST_KIND.TAVERN,
	siteId: 'unknown-inn',
	discovered: false,
	open: false,
	inCombat: true,
	fatigueKm: 12,
});
assert.deepEqual(blockedTavern.reasons, [
	JOURNEY_REST_BLOCK_REASON.REST_SITE_CLOSED,
	JOURNEY_REST_BLOCK_REASON.TAVERN_NOT_DISCOVERED,
	JOURNEY_REST_BLOCK_REASON.COMBAT_ACTIVE,
]);

const noFatigue = evaluateRestRequest(expeditionReady, {
	kind: REST_KIND.TAVERN,
	siteId: 'dragonstone-harbor-tavern',
	discovered: true,
	fatigueKm: 0,
});
assert.deepEqual(noFatigue.reasons, [JOURNEY_REST_BLOCK_REASON.NO_FATIGUE_TO_RECOVER]);

const withTavern = evaluateJourneyWithRestStops(expeditionReady, [
	{ type: 'travel', originId: 'dragonstone', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
	{ type: 'rest', kind: REST_KIND.TAVERN, siteId: 'watch-road-tavern', discovered: true, open: true },
	{ type: 'travel', originId: 'watch-road', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 30 },
]);
assert.equal(withTavern.complete, true);
assert.equal(withTavern.totalDistanceKm, 58);
assert.equal(withTavern.steps[0].fatigueAfterKm, 28);
assert.equal(withTavern.steps[1].fatigueAfterKm, 0);
assert.equal(withTavern.steps[2].fatigueAfterKm, 30);
assert.equal(withTavern.finalFatigueKm, 30);

const exhaustedWithoutRest = evaluateJourneyWithRestStops(expeditionReady, [
	{ type: 'travel', destinationId: 'watch-road', discovered: true, routeOpen: true, distanceKm: 28 },
	{ type: 'travel', destinationId: 'harbor-road', discovered: true, routeOpen: true, distanceKm: 20 },
]);
assert.equal(exhaustedWithoutRest.complete, false);
assert.equal(exhaustedWithoutRest.blockedAtStepIndex, 1);
assert.deepEqual(exhaustedWithoutRest.steps[1].reasons, [JOURNEY_REST_BLOCK_REASON.CONTINUOUS_TRAVEL_EXHAUSTED]);
assert.equal(exhaustedWithoutRest.finalFatigueKm, 28);
assert.equal(exhaustedWithoutRest.totalDistanceKm, 28);

const partialCamp = evaluateJourneyWithRestStops(expeditionReady, [
	{ type: 'travel', destinationId: 'ridge', discovered: true, routeOpen: true, distanceKm: 30 },
	{ type: 'rest', kind: REST_KIND.CAMP, siteId: 'ridge-camp', open: true },
	{ type: 'travel', destinationId: 'harbor', discovered: true, routeOpen: true, distanceKm: 24 },
]);
assert.equal(partialCamp.complete, true);
assert.equal(partialCamp.steps[1].fatigueAfterKm, 13.5);
assert.equal(partialCamp.finalFatigueKm, 37.5);

const text = buildJourneyRestText(withTavern);
assert.match(text, /Sefer Dinlenme Planı/);
assert.match(text, /Taverna · watch-road-tavern · DİNLENDİ/);
assert.match(text, /Plan hazır · son yorgunluk: 30 km/);

const forgedContext = { type: 'travel', destinationId: 'sealed-road', discovered: 1, routeOpen: 0, distanceKm: 4 };
const forgedPlan = evaluateJourneyWithRestStops(expeditionReady, [forgedContext]);
assert.equal(forgedPlan.complete, false);
assert.equal(forgedPlan.steps[0].allowed, false);
assert.deepEqual(forgedContext, { type: 'travel', destinationId: 'sealed-road', discovered: 1, routeOpen: 0, distanceKm: 4 });

console.log('Interaction journey rest contract: PASS');
