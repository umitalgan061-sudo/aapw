#!/usr/bin/env node
import assert from 'node:assert/strict';
import { REGION_IDS, SETTLEMENT_GEOGRAPHY_POLICY, resolveSettlementGeographyContext, resolveSettlementPreferredMaterialRole, scoreSettlementArchitectureSite, selectSettlementArchitectureVariant, isSettlementGeographyPolicySane } from '../src/3d/world/settlementGeographyPolicy.js';
import { getSettlementHouseTypeWeights, isSettlementHouseTypeMixSane, pickSettlementHouseTypeIndex } from '../src/3d/world/settlementHouseTypeMix.js';

assert.equal(isSettlementGeographyPolicySane(), true);
assert.equal(isSettlementHouseTypeMixSane(), true);
assert.deepEqual(REGION_IDS, ['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic']);
assert.equal(SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees, 12);

for (const regionId of REGION_IDS) {
	const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
	assert.equal(Object.values(region.weights).reduce((sum, weight) => sum + weight, 0), 1);
	assert.ok(region.preferredRoles.wall);
	assert.ok(region.preferredRoles.roof);
	assert.deepEqual(getSettlementHouseTypeWeights(regionId).length, 3);
}

const goodLowland = { height: 30, seaLevel: 0, slopeDegrees: 2, roadDistance: 18, waterDepth: 0, shorelineDistanceMeters: 18, footprintReliefMeters: 0.2 };
const badSlope = { ...goodLowland, slopeDegrees: 22, roadDistance: 120, shorelineDistanceMeters: Infinity, footprintReliefMeters: 2 };
const maritimeNear = { ...goodLowland, shorelineDistanceMeters: 20 };
const maritimeFar = { ...goodLowland, shorelineDistanceMeters: 180 };
const maritimeWet = { ...maritimeNear, waterDepth: 1.8 };
const mountainHigh = { ...goodLowland, height: 120 };
const mountainLow = { ...goodLowland, height: 4 };
assert.ok(scoreSettlementArchitectureSite('fertile', goodLowland) > scoreSettlementArchitectureSite('fertile', badSlope));
assert.ok(scoreSettlementArchitectureSite('maritime', maritimeNear) > scoreSettlementArchitectureSite('maritime', maritimeFar));
assert.ok(scoreSettlementArchitectureSite('maritime', maritimeNear) > scoreSettlementArchitectureSite('maritime', maritimeWet));
assert.ok(scoreSettlementArchitectureSite('mountain', mountainHigh) > scoreSettlementArchitectureSite('mountain', mountainLow));
assert.equal(selectSettlementArchitectureVariant('fertile', goodLowland, 0.99), 'primary');
assert.equal(selectSettlementArchitectureVariant('fertile', badSlope, 0), 'secondary');
assert.equal(resolveSettlementPreferredMaterialRole('volcanic', 'wall'), 'brick');

const context = resolveSettlementGeographyContext({ ...goodLowland, shorelineDistanceMeters: 24, footprintReliefMeters: 0.7 });
assert.equal(context.elevationAboveSea, 30);
assert.equal(context.shorelineDistanceMeters, 24);
assert.equal(context.footprintReliefMeters, 0.7);
assert.ok(context.foundationScore > 0 && context.foundationScore < 1);

const rolls = [0, 0.2, 0.49, 0.8, 0.99];
assert.deepEqual(rolls.map((roll) => pickSettlementHouseTypeIndex(roll, 'arid')), [0, 0, 1, 2, 2]);
assert.equal(pickSettlementHouseTypeIndex(0.1, 'unknown'), null);

console.log('[checkSettlementGeographyPolicy] PASS', JSON.stringify({
	policyId: SETTLEMENT_GEOGRAPHY_POLICY.id,
	regions: REGION_IDS.length,
	fertileGood: scoreSettlementArchitectureSite('fertile', goodLowland),
	fertileBad: scoreSettlementArchitectureSite('fertile', badSlope),
	maritimeNear: scoreSettlementArchitectureSite('maritime', maritimeNear),
	maritimeFar: scoreSettlementArchitectureSite('maritime', maritimeFar),
	mountainHigh: scoreSettlementArchitectureSite('mountain', mountainHigh),
	mountainLow: scoreSettlementArchitectureSite('mountain', mountainLow),
}));