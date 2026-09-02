#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const npc = read('src/3d/gameplay/npc.js');
const placement = read('src/3d/gameplay/npcWorldPlacement.js');
const config = read('src/3d/gameplay/npcConfig.js');
const materialCore = read('src/3d/materials/MaterialAssignmentCore.js');
const placementCore = read('src/3d/world/WorldAssetPlacementPipeline.js');

function expect(source, expression, message) {
	assert.match(source, expression, message);
}

function reject(source, expression, message) {
	assert.doesNotMatch(source, expression, message);
}

expect(npc, /from '\.\/npcWorldPlacement\.js'/, 'NPC runtime must import its placement adapter');
expect(npc, /resolveConfiguredNpcSpawnPlacement\s*\(/, 'configured spawn must resolve canonical geography before load');
expect(npc, /resolveConfiguredNpcPatrol\s*\(/, 'configured patrol must validate its route');
expect(npc, /prepareConfiguredNpcWorldAsset\s*\(/, 'configured character must pass the shared world material gate');
expect(npc, /controller\.dispose\(\)/, 'failed material placement must dispose loaded character resources');
expect(npc, /disabledByGeography/, 'patrol geography rejection must be observable in runtime telemetry');

expect(placement, /MaterialAssignmentCore\.js/, 'NPC placement adapter must consume shared MaterialAssignmentCore');
expect(placement, /WorldAssetPlacementPipeline\.js/, 'NPC placement adapter must consume shared WorldAssetPlacementPipeline');
expect(placement, /worldReferenceAlignment\.js/, 'NPC placement must consume canonical owner-map alignment');
expect(placement, /worldReferenceMap\.js/, 'NPC placement must consume canonical biome zones');
expect(placement, /worldReferenceSurfacePindexes\.js/, 'NPC placement must consume canonical hydrology/base surface mask');
expect(placement, /prepareWorldAssetForPlacement\s*\(/, 'NPC model must be prepared by the shared world pipeline');
expect(placement, /auditWorldAssetPlacement\s*\(/, 'NPC model must be audited after material and placement preparation');
expect(placement, /evaluateWorldSurfacePlacement\s*\(/, 'spawn and patrol surfaces must use the shared surface policy evaluator');
expect(placement, /maxSlopeDegrees:\s*26/, 'guard ground must have a bounded slope policy');
expect(placement, /maxWaterDepth:\s*0\.05/, 'guard ground must reject meaningful water depth');
expect(placement, /forbiddenWaterTypes:\s*\['sea', 'lake'\]/, 'guards must reject canonical sea and lake cells');
expect(placement, /MAX_RELOCATION_METERS\s*=\s*8/, 'spawn repair must stay local to its settlement');
expect(placement, /MIN_KEEP_CLEARANCE_METERS\s*=\s*10/, 'guard placement must clear the keep footprint');
expect(placement, /MAX_KEEP_ENVELOPE_METERS\s*=\s*30/, 'guard placement must remain in settlement envelope');
expect(placement, /ROUTE_SAMPLE_SPACING_METERS\s*=\s*4/, 'patrol corridors must be sampled densely enough for hydrology/slope safety');
expect(placement, /MAX_ROUTE_SAMPLES\s*=\s*12/, 'patrol geography checks must remain bounded');
expect(placement, /mode:\s*'surface'/, 'named character parts must use surface recipes');
expect(placement, /mode:\s*'layers'/, 'single-surface characters must use layered fallback');
expect(placement, /mode:\s*'auto'/, 'unnamed multi-mesh characters must retain a shared figure-kit fallback');
expect(placement, /profile\.boot/, 'layered fallback must include boots');
expect(placement, /profile\.trousers/, 'layered fallback must include trousers');
expect(placement, /profile\.belt/, 'layered fallback must include belt/gear');
expect(placement, /profile\.tunic/, 'layered fallback must include clothing');
expect(placement, /profile\.skin/, 'layered fallback must include skin');
expect(placement, /profile\.hair/, 'layered fallback must include hair/head region');
expect(placement, /uniformProfileId/, 'geographic uniform selection must be recorded for proof');
expect(placement, /generatedMaterialCount/, 'shared generated-material count must be exposed for acceptance');
expect(placement, /authoredTextureSlotsBeforeAssignment/, 'pre-assignment authored texture state must remain auditable');
expect(placement, /highQualityAuthoredSlotsBeforeAssignment/, 'high-quality authored PBR evidence must be observable');
reject(npc, /EditorMaterialStudio/, 'runtime NPC path must never import editor DOM/UI code');
reject(placement, /EditorMaterialStudio/, 'placement adapter must remain DOM/editor independent');
reject(placement, /Math\.random\s*\(/, 'placement and appearance variation must be deterministic');

expect(materialCore, /export function validateMaterialAssignment/, 'shared MaterialAssignmentCore successor is missing validation');
expect(materialCore, /export function createMaterialManifest/, 'shared MaterialAssignmentCore successor is missing manifests');
expect(placementCore, /export function prepareWorldAssetForPlacement/, 'shared WorldAssetPlacementPipeline successor is missing preparation gate');
expect(placementCore, /export function auditWorldAssetPlacement/, 'shared WorldAssetPlacementPipeline successor is missing audit gate');

const modelUrls = [...config.matchAll(/modelUrl:\s*'([^']+)'/g)].map((match) => match[1]);
const uniqueModels = [...new Set(modelUrls)].sort();
assert.equal(uniqueModels.length, 6, `expected six configured character asset families, got ${uniqueModels.length}: ${uniqueModels.join(', ')}`);
assert.ok(modelUrls.length >= 10, `expected distributed guard population, got ${modelUrls.length} configured spawns`);
for (const modelUrl of uniqueModels) {
	assert.match(modelUrl, /^assets\/models\/characters\/.+\.fbx$/, `configured guard must use real character FBX asset: ${modelUrl}`);
	const absolute = path.join(root, modelUrl);
	assert.ok(fs.existsSync(absolute), `configured character asset path missing from checkout: ${modelUrl}`);
	const bytes = fs.readFileSync(absolute);
	assert.ok(bytes.length > 0, `configured character asset is empty: ${modelUrl}`);
	if (bytes.subarray(0, 200).toString('utf8').includes('version https://git-lfs.github.com/spec/v1')) {
		assert.ok(bytes.length < 1024, `LFS pointer sanity mismatch for ${modelUrl}`);
	}
}

const requiredGeographyTelemetry = [
	'baseSurface', 'biome', 'zoneId', 'slopeDegrees', 'relocated', 'relocationMeters', 'seatDistanceMeters',
];
for (const key of requiredGeographyTelemetry) {
	expect(placement, new RegExp(`\\b${key}\\b`), `missing NPC geography telemetry field ${key}`);
}

console.log('NPC_WORLD_PLACEMENT_CONTRACT_PASS', JSON.stringify({
	configuredSpawns: modelUrls.length,
	uniqueModels,
	sharedMaterialCore: true,
	sharedPlacementCore: true,
	maxSlopeDegrees: 26,
	maxRelocationMeters: 8,
	routeSampleSpacingMeters: 4,
}));
