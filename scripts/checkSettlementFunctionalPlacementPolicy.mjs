#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY,
	SETTLEMENT_FUNCTIONAL_ROLES,
	buildSettlementFunctionalPlacementPlan,
	createSettlementFunctionalPlacementManifest,
	isSettlementFunctionalPlacementPolicySane,
	resolveSettlementFunctionalAssetClass,
	resolveSettlementFunctionalInteraction,
	scoreSettlementFunctionalRoles,
	scoreSettlementFunctionalSite,
	selectSettlementFunctionalSite,
} from '../src/3d/world/settlementFunctionalPlacementPolicy.js';

assert.equal(isSettlementFunctionalPlacementPolicySane(), true);
assert.deepEqual(SETTLEMENT_FUNCTIONAL_ROLES, [
	'market', 'tavern', 'blacksmith', 'stable', 'farm', 'barracks', 'barn',
]);
assert.ok(SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.innerRadiusMeters < SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.outerServiceRadiusMeters);
assert.ok(SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFarmSlopeDegrees < SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.maximumFunctionalSlopeDegrees);

const innerRoad = {
	x: 10,
	z: 0,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 2,
	roadDistanceMeters: 14,
	waterDistanceMeters: 70,
	waterDepth: 0,
	soilAccessScore: 0.35,
	visibilityScore: 0.95,
	roadAccessScore: 0.95,
};
const tavernParcel = {
	x: 15,
	z: 5,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 3,
	roadDistanceMeters: 17,
	waterDistanceMeters: 75,
	waterDepth: 0,
	soilAccessScore: 0.2,
	visibilityScore: 0.93,
	roadAccessScore: 0.9,
};
const forgeParcel = {
	x: 22,
	z: 10,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 4,
	roadDistanceMeters: 22,
	waterDistanceMeters: 90,
	waterDepth: 0,
	soilAccessScore: 0.25,
	visibilityScore: 0.82,
	roadAccessScore: 0.88,
};
const stableParcel = {
	x: 31,
	z: 7,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 5,
	roadDistanceMeters: 28,
	waterDistanceMeters: 120,
	waterDepth: 0,
	soilAccessScore: 0.45,
	visibilityScore: 0.84,
	roadAccessScore: 0.87,
};
const farmParcel = {
	x: 41,
	z: 12,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 3,
	roadDistanceMeters: 35,
	waterDistanceMeters: 82,
	waterDepth: 0,
	soilAccessScore: 0.96,
	visibilityScore: 0.56,
	roadAccessScore: 0.74,
};
const barracksParcel = {
	x: 30,
	z: -22,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 2,
	roadDistanceMeters: 23,
	waterDistanceMeters: 110,
	waterDepth: 0,
	soilAccessScore: 0.25,
	visibilityScore: 0.98,
	roadAccessScore: 0.9,
};
const badSlopeParcel = {
	x: 12,
	z: 4,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 18,
	roadDistanceMeters: 10,
	waterDistanceMeters: 30,
	waterDepth: 0,
	soilAccessScore: 0.8,
	visibilityScore: 0.9,
	roadAccessScore: 0.9,
};
const wetParcel = {
	x: 12,
	z: -4,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 2,
	roadDistanceMeters: 10,
	waterDistanceMeters: 0,
	waterDepth: 0.8,
	soilAccessScore: 0.9,
	visibilityScore: 0.9,
	roadAccessScore: 0.9,
};
const remoteFarm = {
	x: 75,
	z: 40,
	settlementCenterX: 0,
	settlementCenterZ: 0,
	slopeDegrees: 4,
	roadDistanceMeters: 36,
	waterDistanceMeters: 260,
	waterDepth: 0,
	soilAccessScore: 0.94,
	visibilityScore: 0.55,
	roadAccessScore: 0.7,
};

const marketScore = scoreSettlementFunctionalSite('market', innerRoad);
const tavernScore = scoreSettlementFunctionalSite('tavern', tavernParcel);
const blacksmithScore = scoreSettlementFunctionalSite('blacksmith', forgeParcel);
const stableScore = scoreSettlementFunctionalSite('stable', stableParcel);
const farmScore = scoreSettlementFunctionalSite('farm', farmParcel);
const barracksScore = scoreSettlementFunctionalSite('barracks', barracksParcel);

for (const score of [marketScore, tavernScore, blacksmithScore, stableScore, farmScore, barracksScore]) {
	assert.ok(score > 0, `expected viable functional parcel score, got ${score}`);
	assert.ok(score <= 1, `functional score outside [0,1]: ${score}`);
}

assert.equal(scoreSettlementFunctionalSite('market', badSlopeParcel), 0);
assert.equal(scoreSettlementFunctionalSite('stable', wetParcel), 0);
assert.equal(scoreSettlementFunctionalSite('market', { ...innerRoad, occupied: true }), 0);
assert.equal(scoreSettlementFunctionalSite('market', { ...innerRoad, reserved: true }), 0);
assert.equal(scoreSettlementFunctionalSite('market', { ...innerRoad, isCanonicalParcel: false }), 0);
assert.equal(scoreSettlementFunctionalSite('farm', remoteFarm), 0);

const roleScores = scoreSettlementFunctionalRoles(innerRoad);
assert.deepEqual(Object.keys(roleScores), SETTLEMENT_FUNCTIONAL_ROLES);
assert.ok(roleScores.market > roleScores.farm);
assert.equal(typeof roleScores.blacksmith, 'number');

const candidatePool = [innerRoad, tavernParcel, forgeParcel, stableParcel, farmParcel, barracksParcel];
const bestMarket = selectSettlementFunctionalSite('market', candidatePool);
assert.ok(bestMarket);
assert.equal(bestMarket.role, 'market');
assert.ok(bestMarket.score >= 0.22);
assert.equal(bestMarket.x, innerRoad.x);
assert.equal(bestMarket.z, innerRoad.z);

const unavailable = selectSettlementFunctionalSite('market', [badSlopeParcel], { minimumScore: 0.22 });
assert.equal(unavailable, null);

const duplicatePool = [
	{ ...innerRoad },
	{ ...innerRoad },
	{ ...tavernParcel },
];
const plan = buildSettlementFunctionalPlacementPlan(duplicatePool, {
	roles: ['market', 'tavern'],
	minimumScore: 0,
});
assert.equal(plan.policyId, SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.id);
assert.equal(plan.candidateCount, duplicatePool.length);
assert.equal(plan.assignedCandidateCount, 2);
assert.equal(plan.roles.length, 2);
assert.equal(plan.roles[0].role, 'market');
assert.equal(plan.roles[0].available, true);
assert.equal(plan.roles[1].role, 'tavern');
assert.equal(plan.roles[1].available, true);
assert.notDeepEqual(plan.roles[0].position, plan.roles[1].position);

const weakPlan = buildSettlementFunctionalPlacementPlan([badSlopeParcel], {
	roles: ['market', 'tavern', 'blacksmith'],
	minimumScore: 0.5,
});
assert.equal(weakPlan.assignedCandidateCount, 0);
assert.equal(weakPlan.roles.length, 3);
assert.equal(weakPlan.roles.every((entry) => entry.available === false), true);
assert.equal(weakPlan.roles.every((entry) => entry.reason === 'no-safe-canonical-parcel'), true);

const manifest = createSettlementFunctionalPlacementManifest(plan);
assert.ok(manifest);
assert.equal(manifest.policyId, SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.id);
assert.equal(manifest.entries.length, 2);
assert.equal(manifest.entries[0].role, 'market');
assert.equal(manifest.entries[0].assetClass, 'vendor-stall');
assert.equal(manifest.entries[0].interaction.interaction, 'trade');
assert.equal(manifest.entries[0].interaction.service, 'market-trade');
assert.ok(manifest.entries[0].position);
assert.equal(createSettlementFunctionalPlacementManifest(null), null);
assert.equal(createSettlementFunctionalPlacementManifest({ roles: [] }).entries.length, 0);

const expectedClasses = {
	market: 'vendor-stall',
	tavern: 'tavern-house',
	blacksmith: 'blacksmith-forge',
	stable: 'stable-barn',
	farm: 'farm-plot',
	barn: 'barn-storage',
	barracks: 'barracks-garrison',
};
const expectedInteractions = {
	market: ['trade', 'market-trade'],
	tavern: ['rest', 'tavern-rest'],
	blacksmith: ['craft', 'smithing'],
	stable: ['travel', 'stable-travel'],
	farm: ['provision', 'farm-provisioning'],
	barn: ['storage', 'farm-storage'],
	barracks: ['quest', 'barracks-quest'],
};
for (const role of SETTLEMENT_FUNCTIONAL_ROLES) {
	assert.equal(resolveSettlementFunctionalAssetClass(role), expectedClasses[role]);
	const interaction = resolveSettlementFunctionalInteraction(role);
	assert.deepEqual([interaction.interaction, interaction.service], expectedInteractions[role]);
}
assert.equal(resolveSettlementFunctionalAssetClass('unknown'), null);
assert.equal(resolveSettlementFunctionalInteraction('unknown'), null);

const reordered = [...candidatePool].reverse();
const planA = buildSettlementFunctionalPlacementPlan(candidatePool, { roles: SETTLEMENT_FUNCTIONAL_ROLES, minimumScore: 0 });
const planB = buildSettlementFunctionalPlacementPlan(reordered, { roles: SETTLEMENT_FUNCTIONAL_ROLES, minimumScore: 0 });
assert.deepEqual(planA, planB);

const stableTies = [
	{ x: 10, z: 0, settlementCenterX: 0, settlementCenterZ: 0, slopeDegrees: 0, roadDistanceMeters: 18, waterDistanceMeters: 40, waterDepth: 0, soilAccessScore: 0.4, visibilityScore: 0.8, roadAccessScore: 0.8 },
	{ x: -10, z: 0, settlementCenterX: 0, settlementCenterZ: 0, slopeDegrees: 0, roadDistanceMeters: 18, waterDistanceMeters: 40, waterDepth: 0, soilAccessScore: 0.4, visibilityScore: 0.8, roadAccessScore: 0.8 },
];
const tiePlan = selectSettlementFunctionalSite('market', stableTies, { minimumScore: 0 });
assert.ok(tiePlan);
assert.equal(tiePlan.x, -10);

const farRoad = { ...innerRoad, roadDistanceMeters: 90 };
assert.equal(scoreSettlementFunctionalSite('market', farRoad), 0);

const farmDryButNear = { ...farmParcel, waterDistanceMeters: 115 };
const farmWaterNear = { ...farmParcel, waterDistanceMeters: 80 };
assert.ok(scoreSettlementFunctionalSite('farm', farmWaterNear) > scoreSettlementFunctionalSite('farm', farmDryButNear));

const farmSteep = { ...farmParcel, slopeDegrees: 11 };
assert.equal(scoreSettlementFunctionalSite('farm', farmSteep), 0);

const stableInner = { ...stableParcel, x: 10, z: 3 };
assert.equal(scoreSettlementFunctionalSite('stable', stableInner), 0);

const barracksTooClose = { ...barracksParcel, x: 4, z: 2 };
assert.equal(scoreSettlementFunctionalSite('barracks', barracksTooClose), 0);

const canonicalReserved = { ...innerRoad, occupied: false, reserved: false, isCanonicalParcel: true };
assert.ok(scoreSettlementFunctionalSite('market', canonicalReserved) > 0);

console.log('[checkSettlementFunctionalPlacementPolicy] PASS', JSON.stringify({
	policyId: SETTLEMENT_FUNCTIONAL_PLACEMENT_POLICY.id,
	roles: SETTLEMENT_FUNCTIONAL_ROLES.length,
	marketScore,
	tavernScore,
	blacksmithScore,
	stableScore,
	farmScore,
	barracksScore,
	assignedRoleCount: plan.assignedCandidateCount,
	deterministicPlan: true,
	sharedPlacementAuthority: 'WorldAssetPlacementPipeline',
}));
