#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const villagesSource = fs.readFileSync(path.join(ROOT, 'src/3d/world/villages.js'), 'utf8');
const policySource = fs.readFileSync(path.join(ROOT, 'src/3d/world/settlementGeographyPolicy.js'), 'utf8');

const {
	REGION_IDS,
	SETTLEMENT_GEOGRAPHY_POLICY,
	compareSettlementArchitectureCandidates,
	isSettlementGeographyPolicySane,
	resolveSettlementArchitectureEvidence,
	resolveSettlementGeographyContext,
	resolveSettlementPreferredMaterialRole,
	scoreSettlementArchitectureSite,
	selectSettlementArchitectureVariant,
} = await import('../src/3d/world/settlementGeographyPolicy.js');

assert.equal(isSettlementGeographyPolicySane(), true, 'every geography profile must have normalised weights');
assert.deepEqual(REGION_IDS, ['north', 'fertile', 'maritime', 'arid', 'mountain', 'temperate', 'volcanic']);
assert.equal(SETTLEMENT_GEOGRAPHY_POLICY.context.maxArchitecturalSlopeDegrees, 12);

for (const regionId of REGION_IDS) {
	const region = SETTLEMENT_GEOGRAPHY_POLICY.regions[regionId];
	const total = Object.values(region.weights).reduce((sum, value) => sum + value, 0);
	assert.ok(Math.abs(total - 1) < 1e-6, `${regionId} weights must sum to one`);
	assert.ok(region.preferredRoles.wall, `${regionId} must define a wall role`);
	assert.ok(region.preferredRoles.roof, `${regionId} must define a roof role`);
}

const flatRoad = { height: 30, seaLevel: 0, slopeDegrees: 2, roadDistance: 18, waterDepth: 0 };
const steepFar = { height: 30, seaLevel: 0, slopeDegrees: 22, roadDistance: 120, waterDepth: 0 };
assert.ok(scoreSettlementArchitectureSite('fertile', flatRoad) > scoreSettlementArchitectureSite('fertile', steepFar));
assert.ok(scoreSettlementArchitectureSite('maritime', { ...flatRoad, waterDepth: 0.15 }) > scoreSettlementArchitectureSite('maritime', { ...flatRoad, waterDepth: 4 }));
assert.ok(scoreSettlementArchitectureSite('mountain', { ...flatRoad, height: 120 }) > scoreSettlementArchitectureSite('mountain', { ...flatRoad, height: 4 }));
assert.equal(selectSettlementArchitectureVariant('fertile', flatRoad, 0.99), 'primary');
assert.equal(selectSettlementArchitectureVariant('fertile', steepFar, 0), 'secondary');
assert.equal(resolveSettlementPreferredMaterialRole('volcanic', 'trim'), 'rock');

const context = resolveSettlementGeographyContext({ height: 62, seaLevel: 6, slopeDegrees: 7, roadDistance: 21, waterDepth: 0.12 });
assert.equal(context.elevationAboveSea, 56);
assert.ok(context.lowSlopeScore > 0.2 && context.lowSlopeScore <= 1);
assert.ok(context.roadScore > 0.9);
assert.ok(context.coastScore > 0.9);

const a = { houseIndex: 3, surfaceContext: flatRoad };
const b = { houseIndex: 9, surfaceContext: steepFar };
assert.ok(compareSettlementArchitectureCandidates('fertile', a, b) < 0, 'higher-quality parcel must sort first');
const evidence = resolveSettlementArchitectureEvidence('fertile', { ...flatRoad, houseIndex: 3, roll: 0.37 });
assert.equal(evidence.policyId, SETTLEMENT_GEOGRAPHY_POLICY.id);
assert.equal(evidence.regionId, 'fertile');
assert.ok(Number.isFinite(evidence.score));
assert.ok(['primary', 'secondary'].includes(evidence.variant));

const requiredVillageTokens = [
	"./settlementGeographyPolicy.js",
	'candidateSurfaceContext',
	'assetVariant',
	'architectureScore',
	'geographyPairScore',
	'villageArchitectureGeographyPolicy',
	'resolveSettlementArchitectureEvidence',
	'scoreSettlementArchitectureSite',
	'selectSettlementArchitectureVariant',
	'WorldAssetPlacementPipeline.js',
	'placeWorldAsset(',
	"requireSurfaceContext: true",
	"footprintGrounding: 'always'",
];
for (const token of requiredVillageTokens) assert.ok(villagesSource.includes(token), `villages.js missing geography integration token: ${token}`);
assert.ok(!villagesSource.includes('EditorMaterialStudio'), 'runtime village code must remain editor-free');
assert.ok(policySource.includes('Deterministic geography-to-settlement policy'));
assert.ok(policySource.includes('does not own height, hydrology, roads, materials or asset loading'));

const assetPaths = [...new Set([...villagesSource.matchAll(/\b(?:assetUrl|secondaryAssetUrl):\s*'([^']+\.glb)'/g)].map((match) => match[1]))];
assert.ok(assetPaths.length >= 6, `expected regional asset diversity, found ${assetPaths.length}`);
for (const assetPath of assetPaths) {
	const absolute = path.join(ROOT, assetPath);
	assert.ok(fs.existsSync(absolute), `missing settlement asset: ${assetPath}`);
	const head = fs.readFileSync(absolute).subarray(0, 160).toString('utf8');
	assert.ok(!head.startsWith('version https://git-lfs.github.com/spec'), `LFS pointer not hydrated: ${assetPath}`);
	assert.equal(head.slice(0, 4), 'glTF', `not a GLB: ${assetPath}`);
}

console.log('[checkSettlementGeographyAssetContract] PASS', JSON.stringify({
	policyId: SETTLEMENT_GEOGRAPHY_POLICY.id,
	regionCount: REGION_IDS.length,
	assetCount: assetPaths.length,
	flatRoadFertileScore: scoreSettlementArchitectureSite('fertile', flatRoad),
	steepFarFertileScore: scoreSettlementArchitectureSite('fertile', steepFar),
	maritimeCoastalScore: scoreSettlementArchitectureSite('maritime', { ...flatRoad, waterDepth: 0.15 }),
	maritimeInlandScore: scoreSettlementArchitectureSite('maritime', { ...flatRoad, waterDepth: 4 }),
	mountainHighlandScore: scoreSettlementArchitectureSite('mountain', { ...flatRoad, height: 120 }),
	mountainLowlandScore: scoreSettlementArchitectureSite('mountain', { ...flatRoad, height: 4 }),
}));