#!/usr/bin/env node
import assert from 'node:assert/strict';
import {
	SETTLEMENT_ASSET_ROLE_POLICY,
	SETTLEMENT_ASSET_ROLE_POLICY_ID,
	SETTLEMENT_ASSET_ROLES,
	evaluateSettlementAssetRoleCompatibility,
	getSettlementAssetRole,
	inferSettlementAssetRoleFromPath,
	isSettlementAssetPathApprovedForRole,
	isSettlementAssetRolePolicySane,
} from '../src/3d/world/settlementAssetRolePolicy.js';

assert.equal(isSettlementAssetRolePolicySane(), true);
assert.equal(SETTLEMENT_ASSET_ROLE_POLICY.id, SETTLEMENT_ASSET_ROLE_POLICY_ID);
assert.ok(SETTLEMENT_ASSET_ROLES.length >= 10);
assert.deepEqual(SETTLEMENT_ASSET_ROLES, [
	'residential',
	'market',
	'tavern',
	'blacksmith',
	'stable',
	'farm',
	'barn',
	'barracks',
	'entry',
	'storage',
]);

for (const roleId of SETTLEMENT_ASSET_ROLES) {
	const role = getSettlementAssetRole(roleId);
	assert.ok(role);
	assert.equal(role.id, roleId);
	assert.ok(role.approvedRoots.length > 0);
	assert.ok(role.filenameTokens.length > 0);
	assert.ok(role.preferredMaterialRoles);
	assert.ok(role.placementConstraints);
}

assert.equal(getSettlementAssetRole('unknown'), null);
assert.equal(inferSettlementAssetRoleFromPath('assets/models/settlements/blacksmith_bV52eTG1Aj.glb'), 'blacksmith');
assert.equal(inferSettlementAssetRoleFromPath('assets/models/settlements/barracks_UXCOwRBSxx.glb'), 'barracks');
assert.equal(inferSettlementAssetRoleFromPath('assets/models/settlements/barn_0QTh_KUZRYE.glb'), 'stable');
assert.equal(inferSettlementAssetRoleFromPath('assets/models/settlements/fantasy_house_dcPho4SUA3.glb'), 'residential');
assert.equal(inferSettlementAssetRoleFromPath('assets/models/houses/small_wooden_house.glb'), 'residential');
assert.equal(inferSettlementAssetRoleFromPath(''), null);
assert.equal(inferSettlementAssetRoleFromPath(null), null);

assert.equal(isSettlementAssetPathApprovedForRole('blacksmith', 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb'), true);
assert.equal(isSettlementAssetPathApprovedForRole('residential', 'assets/models/houses/small_wooden_house.glb'), true);
assert.equal(isSettlementAssetPathApprovedForRole('market', 'assets/models/settlements/market_stall.glb'), true);
assert.equal(isSettlementAssetPathApprovedForRole('market', 'assets/models/props/market_stall.glb'), true);
assert.equal(isSettlementAssetPathApprovedForRole('blacksmith', 'assets/models/houses/blacksmith_house.glb'), false);
assert.equal(isSettlementAssetPathApprovedForRole('blacksmith', 'assets/models/settlements/placeholder_blacksmith.glb'), false);
assert.equal(isSettlementAssetPathApprovedForRole('unknown', 'assets/models/settlements/blacksmith.glb'), false);
assert.equal(isSettlementAssetPathApprovedForRole('blacksmith', ''), false);

const blacksmithGood = evaluateSettlementAssetRoleCompatibility('blacksmith', {
	assetPath: 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
	materialRoles: { wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 3,
	waterDepth: 0,
	roadDistanceMeters: 21,
	radiusMeters: 19,
	visible: true,
	hasBuildingParent: true,
});
assert.equal(blacksmithGood.ok, true);
assert.ok(blacksmithGood.score > 0.5);
assert.equal(blacksmithGood.materialEvidence, 4);
assert.equal(blacksmithGood.materialSlotCount, 4);

const blacksmithWrongMaterial = evaluateSettlementAssetRoleCompatibility('blacksmith', {
	assetPath: 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
	materialRoles: { wall: 'thatch', roof: 'glass', timber: 'iron', trim: 'thatch' },
	slopeDegrees: 3,
	waterDepth: 0,
	roadDistanceMeters: 21,
	radiusMeters: 19,
});
assert.equal(blacksmithWrongMaterial.ok, true);
assert.ok(blacksmithWrongMaterial.materialEvidence < blacksmithGood.materialEvidence);
assert.ok(blacksmithWrongMaterial.score < blacksmithGood.score);

const blacksmithSteep = evaluateSettlementAssetRoleCompatibility('blacksmith', {
	assetPath: 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
	materialRoles: { wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 14,
	waterDepth: 0,
	roadDistanceMeters: 21,
	radiusMeters: 19,
});
assert.equal(blacksmithSteep.ok, false);
assert.equal(blacksmithSteep.reason, 'slope-too-steep');
assert.equal(blacksmithSteep.score, 0);

const blacksmithWet = evaluateSettlementAssetRoleCompatibility('blacksmith', {
	assetPath: 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
	materialRoles: { wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 3,
	waterDepth: 0.4,
	radiusMeters: 19,
	roadDistanceMeters: 21,
});
assert.equal(blacksmithWet.ok, false);
assert.equal(blacksmithWet.reason, 'water-depth-too-high');

const blacksmithTooFar = evaluateSettlementAssetRoleCompatibility('blacksmith', {
	assetPath: 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
	materialRoles: { wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 2,
	waterDepth: 0,
	roadDistanceMeters: 60,
	radiusMeters: 20,
});
assert.equal(blacksmithTooFar.ok, false);
assert.equal(blacksmithTooFar.reason, 'too-far-from-road');

const blacksmithCenter = evaluateSettlementAssetRoleCompatibility('blacksmith', {
	assetPath: 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb',
	materialRoles: { wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 2,
	waterDepth: 0,
	roadDistanceMeters: 21,
	radiusMeters: 5,
});
assert.equal(blacksmithCenter.ok, false);
assert.equal(blacksmithCenter.reason, 'too-close-to-settlement-center');

const marketGood = evaluateSettlementAssetRoleCompatibility('market', {
	assetPath: 'assets/models/settlements/market_stall.glb',
	materialRoles: { wall: 'house', roof: 'thatch', timber: 'wood', trim: 'stone' },
	slopeDegrees: 2,
	waterDepth: 0,
	roadDistanceMeters: 14,
	radiusMeters: 15,
	visible: true,
});
assert.equal(marketGood.ok, true);
assert.ok(marketGood.score > 0.5);
assert.equal(marketGood.materialEvidence, 4);

const marketRemote = evaluateSettlementAssetRoleCompatibility('market', {
	assetPath: 'assets/models/settlements/market_stall.glb',
	materialRoles: { wall: 'house', roof: 'thatch', timber: 'wood', trim: 'stone' },
	slopeDegrees: 2,
	waterDepth: 0,
	roadDistanceMeters: 40,
	radiusMeters: 15,
	visible: true,
});
assert.equal(marketRemote.ok, false);
assert.equal(marketRemote.reason, 'too-far-from-road');

const tavernGood = evaluateSettlementAssetRoleCompatibility('tavern', {
	assetPath: 'assets/models/settlements/tavern.glb',
	materialRoles: { wall: 'house', roof: 'roof-tile', timber: 'wood', trim: 'stone' },
	slopeDegrees: 2,
	waterDepth: 0,
	roadDistanceMeters: 17,
	radiusMeters: 18,
});
assert.equal(tavernGood.ok, true);

const tavernNoRoad = evaluateSettlementAssetRoleCompatibility('tavern', {
	assetPath: 'assets/models/settlements/tavern.glb',
	materialRoles: { wall: 'house', roof: 'roof-tile', timber: 'wood', trim: 'stone' },
	slopeDegrees: 2,
	waterDepth: 0,
	radiusMeters: 18,
	roadDistanceMeters: Infinity,
});
assert.equal(tavernNoRoad.ok, false);
assert.equal(tavernNoRoad.reason, 'too-far-from-road');

const stableGood = evaluateSettlementAssetRoleCompatibility('stable', {
	assetPath: 'assets/models/settlements/barn_A6UkPq33aZ.glb',
	materialRoles: { wall: 'wood', roof: 'thatch', timber: 'wood', trim: 'iron' },
	slopeDegrees: 5,
	waterDepth: 0,
	roadDistanceMeters: 28,
	radiusMeters: 32,
});
assert.equal(stableGood.ok, true);

const stableTooCentral = evaluateSettlementAssetRoleCompatibility('stable', {
	assetPath: 'assets/models/settlements/barn_A6UkPq33aZ.glb',
	materialRoles: { wall: 'wood', roof: 'thatch', timber: 'wood', trim: 'iron' },
	slopeDegrees: 5,
	waterDepth: 0,
	roadDistanceMeters: 28,
	radiusMeters: 18,
});
assert.equal(stableTooCentral.ok, false);
assert.equal(stableTooCentral.reason, 'too-close-to-settlement-center');

const farmGood = evaluateSettlementAssetRoleCompatibility('farm', {
	assetPath: 'assets/models/settlements/barn_0QTh_KUZRYE.glb',
	materialRoles: { wall: 'wood', roof: 'thatch', timber: 'wood', trim: 'stone' },
	slopeDegrees: 4,
	waterDepth: 0,
	roadDistanceMeters: 35,
	radiusMeters: 45,
	soilAccessScore: 0.9,
	waterDistanceMeters: 85,
});
assert.equal(farmGood.ok, true);

const farmNoSoil = evaluateSettlementAssetRoleCompatibility('farm', {
	assetPath: 'assets/models/settlements/barn_0QTh_KUZRYE.glb',
	materialRoles: { wall: 'wood', roof: 'thatch', timber: 'wood', trim: 'stone' },
	slopeDegrees: 4,
	waterDepth: 0,
	roadDistanceMeters: 35,
	radiusMeters: 45,
	soilAccessScore: 0.2,
	waterDistanceMeters: 85,
});
assert.equal(farmNoSoil.ok, false);
assert.equal(farmNoSoil.reason, 'soil-access-too-low');

const farmNoWater = evaluateSettlementAssetRoleCompatibility('farm', {
	assetPath: 'assets/models/settlements/barn_0QTh_KUZRYE.glb',
	materialRoles: { wall: 'wood', roof: 'thatch', timber: 'wood', trim: 'stone' },
	slopeDegrees: 4,
	waterDepth: 0,
	roadDistanceMeters: 35,
	radiusMeters: 45,
	soilAccessScore: 0.9,
	waterDistanceMeters: 300,
});
assert.equal(farmNoWater.ok, false);
assert.equal(farmNoWater.reason, 'farm-water-access-too-distant');

const barracksGood = evaluateSettlementAssetRoleCompatibility('barracks', {
	assetPath: 'assets/models/settlements/barracks_UXCOwRBSxx.glb',
	materialRoles: { wall: 'stone', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 3,
	waterDepth: 0,
	roadDistanceMeters: 24,
	radiusMeters: 32,
	visible: true,
});
assert.equal(barracksGood.ok, true);

const barracksHidden = evaluateSettlementAssetRoleCompatibility('barracks', {
	assetPath: 'assets/models/settlements/barracks_UXCOwRBSxx.glb',
	materialRoles: { wall: 'stone', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 3,
	waterDepth: 0,
	roadDistanceMeters: 24,
	radiusMeters: 32,
	visible: false,
});
assert.equal(barracksHidden.ok, false);
assert.equal(barracksHidden.reason, 'visibility-required');

const entryNoParent = evaluateSettlementAssetRoleCompatibility('entry', {
	assetPath: 'assets/models/settlements/door.glb',
	materialRoles: { wall: 'wood', timber: 'wood', trim: 'iron' },
	slopeDegrees: 2,
	waterDepth: 0,
	roadDistanceMeters: 12,
	radiusMeters: 18,
	hasBuildingParent: false,
});
assert.equal(entryNoParent.ok, false);
assert.equal(entryNoParent.reason, 'building-parent-required');

const storageFree = evaluateSettlementAssetRoleCompatibility('storage', {
	assetPath: 'assets/models/props/chest.glb',
	materialRoles: { timber: 'wood', trim: 'iron' },
	slopeDegrees: 8,
	waterDepth: 0,
	roadDistanceMeters: 100,
	radiusMeters: 18,
	hasBuildingParent: false,
});
assert.equal(storageFree.ok, true);

const wrongAsset = evaluateSettlementAssetRoleCompatibility('blacksmith', {
	assetPath: 'assets/models/settlements/fantasy_house_dcPho4SUA3.glb',
	materialRoles: { wall: 'brick', roof: 'roof-tile', timber: 'wood', trim: 'iron' },
	slopeDegrees: 2,
	waterDepth: 0,
	roadDistanceMeters: 21,
	radiusMeters: 20,
});
assert.equal(wrongAsset.ok, false);
assert.equal(wrongAsset.reason, 'asset-path-not-approved');

const residentialGood = evaluateSettlementAssetRoleCompatibility('residential', {
	assetPath: 'assets/models/settlements/fantasy_house_dcPho4SUA3.glb',
	materialRoles: { wall: 'plaster', roof: 'thatch', timber: 'wood', trim: 'stone' },
	slopeDegrees: 5,
	waterDepth: 0,
	roadDistanceMeters: 18,
	radiusMeters: 18,
});
assert.equal(residentialGood.ok, true);
assert.ok(residentialGood.score > 0.5);

const residentialFar = evaluateSettlementAssetRoleCompatibility('residential', {
	assetPath: 'assets/models/settlements/fantasy_house_dcPho4SUA3.glb',
	materialRoles: { wall: 'plaster', roof: 'thatch', timber: 'wood', trim: 'stone' },
	slopeDegrees: 5,
	waterDepth: 0,
	roadDistanceMeters: 90,
	radiusMeters: 18,
});
assert.equal(residentialFar.ok, false);
assert.equal(residentialFar.reason, 'too-far-from-road');

assert.ok(SETTLEMENT_ASSET_ROLE_POLICY.roles.blacksmith.functionalServices.includes('smithing'));
assert.ok(SETTLEMENT_ASSET_ROLE_POLICY.roles.market.functionalServices.includes('trade'));
assert.ok(SETTLEMENT_ASSET_ROLE_POLICY.roles.tavern.functionalServices.includes('rest'));
assert.ok(SETTLEMENT_ASSET_ROLE_POLICY.roles.stable.functionalServices.includes('travel'));
assert.ok(SETTLEMENT_ASSET_ROLE_POLICY.roles.barracks.functionalServices.includes('quest'));
assert.ok(SETTLEMENT_ASSET_ROLE_POLICY.roles.farm.functionalServices.includes('provision'));

console.log('[checkSettlementAssetRolePolicy] PASS', JSON.stringify({
	policyId: SETTLEMENT_ASSET_ROLE_POLICY_ID,
	roleCount: SETTLEMENT_ASSET_ROLES.length,
	blacksmithScore: blacksmithGood.score,
	marketScore: marketGood.score,
	stableScore: stableGood.score,
	farmScore: farmGood.score,
	barracksScore: barracksGood.score,
	residentialScore: residentialGood.score,
	materialCompatibility: true,
	geographicConstraints: true,
}));
