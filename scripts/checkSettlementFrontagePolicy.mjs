#!/usr/bin/env node
/**
 * Deterministic unit/static qualification for the settlement road-frontage layer.
 * This deliberately tests the pure policy with representative canonical-road shapes rather than
 * mocking Three.js or inventing map coordinates. It complements the runtime village checks.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
	SETTLEMENT_FRONTAGE_POLICY,
	compareSettlementFrontageQuality,
	findNearestSettlementRoad,
	isSettlementFrontagePolicySane,
	projectPointToRoadSegment,
	resolveSettlementBuildingYaw,
	resolveSettlementFrontageContext,
	resolveSettlementFrontageSetback,
	scoreSettlementFrontage,
} from '../src/3d/world/settlementFrontagePolicy.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const villagesPath = path.join(ROOT, 'src/3d/world/villages.js');
const villagesSource = fs.readFileSync(villagesPath, 'utf8');

assert.equal(isSettlementFrontagePolicySane(), true);
assert.ok(SETTLEMENT_FRONTAGE_POLICY.alignmentDistanceMeters > SETTLEMENT_FRONTAGE_POLICY.preferredRoadDistanceMeters);
assert.ok(SETTLEMENT_FRONTAGE_POLICY.minimumSetbackMeters < SETTLEMENT_FRONTAGE_POLICY.preferredSetbackMeters);
assert.ok(SETTLEMENT_FRONTAGE_POLICY.preferredSetbackMeters < SETTLEMENT_FRONTAGE_POLICY.maximumSetbackMeters);

const straightRoad = [
	{ points: [{ x: -100, z: 0 }, { x: 100, z: 0 }] },
];
const diagonalRoad = [
	{ points: [{ x: -50, z: -50 }, { x: 50, z: 50 }] },
];
const splitRoad = [
	{ points: [{ x: -90, z: 0 }, { x: -10, z: 0 }] },
	{ points: [{ x: 10, z: 0 }, { x: 90, z: 0 }] },
];

const projectedCenter = projectPointToRoadSegment(
	{ x: 12, z: 8 },
	{ x: -100, z: 0 },
	{ x: 100, z: 0 },
);
assert.ok(projectedCenter);
assert.equal(projectedCenter.x, 12);
assert.equal(projectedCenter.z, 0);
assert.equal(projectedCenter.segmentIndex, 0);
assert.ok(Math.abs(projectedCenter.distanceMeters - 8) < 1e-9);
assert.ok(Number.isFinite(projectedCenter.tangentYaw));
assert.ok(Number.isFinite(projectedCenter.normalYaw));

const diagonalProjection = projectPointToRoadSegment(
	{ x: 4, z: 8 },
	{ x: -50, z: -50 },
	{ x: 50, z: 50 },
);
assert.ok(diagonalProjection);
assert.ok(Math.abs(diagonalProjection.x - 6) < 1e-9);
assert.ok(Math.abs(diagonalProjection.z - 6) < 1e-9);
assert.ok(Math.abs(diagonalProjection.distanceMeters - Math.sqrt(8)) < 1e-9);

assert.equal(projectPointToRoadSegment({ x: 0, z: 0 }, { x: 0, z: 0 }, { x: 0, z: 0 }), null);
assert.equal(findNearestSettlementRoad({ x: 0, z: 22 }, straightRoad)?.distanceMeters, 22);
assert.equal(findNearestSettlementRoad({ x: 0, z: 150 }, straightRoad), null);
assert.equal(findNearestSettlementRoad({ x: 30, z: 5 }, diagonalRoad)?.edgeIndex, 0);
assert.equal(findNearestSettlementRoad({ x: 0, z: 8 }, splitRoad)?.segmentIndex, 0);

const nearRoad = findNearestSettlementRoad({ x: 0, z: 12 }, straightRoad);
const farRoad = findNearestSettlementRoad({ x: 0, z: 65 }, straightRoad);
assert.ok(nearRoad);
assert.ok(farRoad === null || farRoad.distanceMeters >= SETTLEMENT_FRONTAGE_POLICY.alignmentDistanceMeters);

const roadAlignedYaw = resolveSettlementBuildingYaw({
	baseYaw: Math.PI * 0.5,
	seed: 7,
	road: nearRoad,
});
const roadFarYaw = resolveSettlementBuildingYaw({
	baseYaw: Math.PI * 0.5,
	seed: 7,
	road: null,
});
assert.notEqual(roadAlignedYaw, roadFarYaw);

const exactAlignment = resolveSettlementBuildingYaw({
	baseYaw: 0,
	seed: 7,
	road: { tangentYaw: Math.PI * 0.25, distanceMeters: 12 },
});
assert.ok(Math.abs(exactAlignment - Math.PI * 0.25) < 1e-9);

const farOrganic = resolveSettlementBuildingYaw({
	baseYaw: 0,
	seed: 123,
	road: { tangentYaw: Math.PI * 0.25, distanceMeters: 100 },
	roadDistanceMeters: 100,
});
const noRoadOrganic = resolveSettlementBuildingYaw({ baseYaw: 0, seed: 123 });
assert.equal(farOrganic, noRoadOrganic);

const setbackNear = resolveSettlementFrontageSetback({ roadDistanceMeters: 12, slopeDegrees: 0, footprintReliefMeters: 0 });
const setbackFar = resolveSettlementFrontageSetback({ roadDistanceMeters: 55, slopeDegrees: 0, footprintReliefMeters: 0 });
const setbackRough = resolveSettlementFrontageSetback({ roadDistanceMeters: 12, slopeDegrees: 10, footprintReliefMeters: 1 });
assert.ok(setbackNear >= SETTLEMENT_FRONTAGE_POLICY.minimumSetbackMeters);
assert.ok(setbackFar > setbackNear);
assert.ok(setbackRough > setbackNear);
assert.ok(setbackRough <= SETTLEMENT_FRONTAGE_POLICY.maximumSetbackMeters);

const frontageGood = scoreSettlementFrontage({
	roadDistanceMeters: 18,
	slopeDegrees: 2,
	footprintReliefMeters: 0.15,
	waterDepth: 0,
	isArchitectureLandmark: true,
});
const frontageBad = scoreSettlementFrontage({
	roadDistanceMeters: 120,
	slopeDegrees: 22,
	footprintReliefMeters: 2,
	waterDepth: 1.8,
	isArchitectureLandmark: false,
});
assert.ok(frontageGood > frontageBad);
assert.ok(frontageGood >= 0 && frontageGood <= 1);
assert.ok(frontageBad >= 0 && frontageBad <= 1);

const context = resolveSettlementFrontageContext({
	x: 0,
	z: 14,
	baseYaw: 0,
	seed: 11,
	roadEdges: straightRoad,
	slopeDegrees: 3,
	waterDepth: 0,
	footprintReliefMeters: 0.2,
	isArchitectureLandmark: true,
});
assert.equal(context.policyId, SETTLEMENT_FRONTAGE_POLICY.id);
assert.equal(context.alignedToCanonicalRoad, true);
assert.ok(context.roadDistanceMeters <= SETTLEMENT_FRONTAGE_POLICY.alignmentDistanceMeters);
assert.ok(context.nearestRoad);
assert.ok(Number.isFinite(context.buildingYawRadians));
assert.ok(context.frontageSetbackMeters >= SETTLEMENT_FRONTAGE_POLICY.minimumSetbackMeters);
assert.ok(context.frontageScore > 0);

const noRoadContext = resolveSettlementFrontageContext({
	x: 0,
	z: 0,
	baseYaw: 0.3,
	seed: 11,
	roadEdges: [],
});
assert.equal(noRoadContext.alignedToCanonicalRoad, false);
assert.equal(noRoadContext.nearestRoad, null);
assert.equal(noRoadContext.roadDistanceMeters, 1_000_000);
assert.ok(Number.isFinite(noRoadContext.frontageScore));

const candidates = [
	{ x: 10, z: 4, frontageScore: 0.71, roadDistanceMeters: 22 },
	{ x: 2, z: 3, frontageScore: 0.91, roadDistanceMeters: 18 },
	{ x: 2, z: 3, frontageScore: 0.91, roadDistanceMeters: 12 },
];
const sorted = [...candidates].sort(compareSettlementFrontageQuality);
assert.equal(sorted[0].roadDistanceMeters, 12);
assert.equal(sorted[1].roadDistanceMeters, 18);
assert.equal(sorted[2].frontageScore, 0.71);

for (const token of [
	"import { resolveSettlementFrontageContext } from './settlementFrontagePolicy.js';",
	'const frontageContext = resolveSettlementFrontageContext({',
	'frontageSurfaceContext',
	'yaw: frontageContext.buildingYawRadians',
	'frontageScore',
	'frontageRoadDistanceMeters',
	'alignedToCanonicalRoad',
	'villageArchitectureFrontagePolicy',
]) {
	assert.ok(villagesSource.includes(token), `villages.js missing shipped frontage integration token: ${token}`);
}
assert.equal(villagesSource.includes('EditorMaterialStudio'), false);
assert.ok(villagesSource.includes('placeWorldAsset(scene'));
assert.ok(villagesSource.includes('requireSurfaceContext: true'));
assert.ok(villagesSource.includes("footprintGrounding: 'always'"));

console.log('[checkSettlementFrontagePolicy] PASS', JSON.stringify({
	policyId: SETTLEMENT_FRONTAGE_POLICY.id,
	alignedRoadDistanceMeters: context.roadDistanceMeters,
	alignedFrontageScore: context.frontageScore,
	setbackNearMeters: setbackNear,
	setbackRoughMeters: setbackRough,
	goodFrontageScore: frontageGood,
	badFrontageScore: frontageBad,
	sharedPlacement: true,
	editorMaterialStudioRuntimeImport: false,
}));
