#!/usr/bin/env node
/**
 * Acceptance contract for the canonical geography -> asset distribution layer.
 *
 * The test is intentionally larger than a smoke test because geography regressions tend to be subtle:
 * a single correct centre-point can still conceal a whole boundary, density, material, or asset-family
 * collapse. Every canonical zone is sampled at its centre and at a deterministic ring of offsets.
 * The policy is also checked against the real repository asset names already tracked by the project.
 *
 * No browser is required. This is a pure deterministic contract that can safely run before the heavier
 * shipped Three.js/PWA gates. It never relaxes existing world tests and never treats a missing GLB as a
 * procedural-generation pass: readiness is represented explicitly in the output so later hydration
 * stages can fail closed.
 */

import assert from 'node:assert/strict';
import {
	BIOME_ASSET_DISTRIBUTION_POLICY,
	BIOME_ASSET_PROFILES,
	REPOSITORY_ASSET_CANDIDATES,
	assertBiomeDistributionConsistency,
	auditBiomeDistributionContract,
	classifySurfaceRole,
	computeBiomeDensityPerKm2,
	listBiomeAssetFamilies,
	mapAssetDistributionToWorldXZ,
	resolveBiomeAssetDistribution,
	resolveBiomeAssetProfileForZone,
	sampleAssetScale,
	selectRegionalArchitectureAsset,
} from '../src/3d/world/biomeAssetDistribution.js';
import { REFERENCE_BIOME_ZONES, REFERENCE_RELIEF_CHAINS, REFERENCE_WATER_ZONES } from '../src/3d/world/worldReferenceMap.js';

const EXPECTED_PROFILE_IDS = [
	'snow',
	'coldGrassland',
	'marsh',
	'mountain',
	'rockyHills',
	'lush',
	'desert',
	'steppe',
	'arid',
	'coast',
	'temperate',
	'jungle',
	'aridSteppe',
	'valyria',
];

const SAMPLE_OFFSETS = [
	Object.freeze([0, 0]),
	Object.freeze([0.012, 0]),
	Object.freeze([-0.012, 0]),
	Object.freeze([0, 0.012]),
	Object.freeze([0, -0.012]),
	Object.freeze([0.008, 0.008]),
	Object.freeze([-0.008, 0.008]),
	Object.freeze([0.008, -0.008]),
	Object.freeze([-0.008, -0.008]),
];

const REQUIRED_FAMILY_GROUPS = Object.freeze({
	forestLike: ['round-tree', 'oak', 'beech', 'pine', 'broadleaf-tall', 'broadleaf-round'],
	dryLike: ['dry-shrub', 'thorn-tree', 'sand-rock', 'red-boulder', 'badlands-rock', 'desert-gravel'],
	rockLike: ['snow-rock', 'alpine-boulder', 'field-boulder', 'shore-boulder', 'basalt-boulder', 'moss-boulder'],
	coldLike: ['snow-pine', 'dead-snow-tree', 'mountain-pine', 'wind-bent-conifer'],
});

const REAL_ASSET_PATHS = Object.values(REPOSITORY_ASSET_CANDIDATES);

function expectFinite(value, label) {
	assert.equal(Number.isFinite(value), true, `${label} must be finite`);
}

function expectRange(value, min, max, label) {
	expectFinite(value, label);
	assert.ok(value >= min && value <= max, `${label} expected ${min}..${max}, got ${value}`);
}

function zoneById(id) {
	const zone = REFERENCE_BIOME_ZONES.find((candidate) => candidate.id === id);
	assert.ok(zone, `missing canonical zone: ${id}`);
	return zone;
}

function checkPolicyShape() {
	assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.deterministic, true);
	assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.renderSemanticOnly, true);
	assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.sourceMapSha256, '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1');
	assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.common.avoidRoadMeters, 10);
	assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.common.avoidSeatMeters, 90);
	assert.equal(BIOME_ASSET_DISTRIBUTION_POLICY.common.assetTextureSize, 256);
	for (const id of EXPECTED_PROFILE_IDS) assert.ok(BIOME_ASSET_PROFILES[id], `expected profile ${id}`);
}

function checkRepositoryAssetCandidates() {
	assert.ok(REAL_ASSET_PATHS.length >= 11, 'repository asset candidate set unexpectedly shrank');
	for (const assetPath of REAL_ASSET_PATHS) {
		assert.match(assetPath, /^assets\/models\/(vegetation|settlements)\/.+\.(glb|fbx)$/);
		assert.ok(!assetPath.includes('EditorMaterialStudio'), `editor-only asset reference leaked into ${assetPath}`);
	}
	assert.equal(REPOSITORY_ASSET_CANDIDATES.winterPine, 'assets/models/vegetation/pine_Zt62gceKXZ.glb');
	assert.equal(REPOSITORY_ASSET_CANDIDATES.winterBare, 'assets/models/vegetation/winter_tree.glb');
	assert.equal(REPOSITORY_ASSET_CANDIDATES.northCabin, 'assets/models/settlements/log_cabin_et0OmFeZVkb.glb');
	assert.equal(REPOSITORY_ASSET_CANDIDATES.blacksmith, 'assets/models/settlements/blacksmith_bV52eTG1Aj.glb');
}

function checkCentreResolution() {
	const records = [];
	for (const zone of REFERENCE_BIOME_ZONES) {
		const first = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'centre-a', { sampleCount: 12 });
		const second = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'centre-a', { sampleCount: 12 });
		assert.deepEqual(second, first, `non-deterministic centre resolution for ${zone.id}`);
		assert.ok(first.zoneCandidates.length > 0, `${zone.id} produced no zone candidate`);
		assertBiomeDistributionConsistency(first);
		expectRange(first.confidence, 0, 1, `${zone.id} confidence`);
		expectRange(first.densityMultiplier, 0, 2, `${zone.id} densityMultiplier`);
		assert.equal(typeof first.profileId, 'string');
		assert.equal(typeof first.profileLabel, 'string');
		assert.ok(first.landCover.primary, `${zone.id} missing primary land cover`);
		assert.ok(first.scatter.length > 0, `${zone.id} missing scatter output`);
		assert.ok(first.geology, `${zone.id} missing geology output`);
		assert.ok(first.architecture, `${zone.id} missing architecture output`);
		records.push({ zoneId: zone.id, profileId: first.profileId, confidence: first.confidence, scatterFamilies: first.scatter.map((item) => item.family) });
	}
	return records;
}

function checkBoundarySampling() {
	let sampleCount = 0;
	const failures = [];
	for (const zone of REFERENCE_BIOME_ZONES) {
		for (const [dx, dy] of SAMPLE_OFFSETS) {
			const x = Math.max(0, Math.min(1, zone.center[0] + dx));
			const y = Math.max(0, Math.min(1, zone.center[1] + dy));
			const context = resolveBiomeAssetDistribution(x, y, `ring:${zone.id}`, { sampleCount: 5 });
			try {
				assertBiomeDistributionConsistency(context);
				expectRange(context.confidence, 0, 1, `${zone.id} ring confidence`);
				assert.ok(context.scatter.length <= 5, `${zone.id} requested scatter sample cap exceeded`);
				for (const item of context.scatter) {
					expectFinite(item.scale, `${zone.id}:${item.family} scale`);
					assert.ok(item.scale > 0, `${zone.id}:${item.family} non-positive scale`);
				}
			} catch (error) {
				failures.push(`${zone.id}@${x.toFixed(4)},${y.toFixed(4)}: ${error instanceof Error ? error.message : String(error)}`);
			}
			sampleCount += 1;
		}
	}
	assert.equal(failures.length, 0, failures.join('\n'));
	assert.equal(sampleCount, REFERENCE_BIOME_ZONES.length * SAMPLE_OFFSETS.length);
	return sampleCount;
}

function checkSpecialRegions() {
	const checks = [
		{ point: [0.660, 0.680], allowed: ['arid', 'aridSteppe'] },
		{ point: [0.555, 0.900], allowed: ['jungle'] },
		{ point: [0.925, 0.945], allowed: ['jungle'] },
		{ point: [0.925, 0.555], allowed: ['aridSteppe', 'steppe', 'arid'] },
	];
	for (const check of checks) {
		const context = resolveBiomeAssetDistribution(check.point[0], check.point[1], 'special', { sampleCount: 7 });
		assert.ok(check.allowed.includes(context.profileId), `special-region ${check.point.join(',')} resolved to ${context.profileId}; expected ${check.allowed.join(', ')}`);
	}
}

function checkZoneProfileRoundTrip() {
	for (const zone of REFERENCE_BIOME_ZONES) {
		const profile = resolveBiomeAssetProfileForZone(zone.id);
		assert.ok(profile, `zone profile missing for ${zone.id}`);
		assert.equal(typeof profile.id, 'string');
		assert.ok(profile.scatter.length > 0);
		assert.ok(profile.geology.length > 0);
		assert.ok(profile.architecture.length > 0);
		const second = resolveBiomeAssetProfileForZone(zone.id);
		assert.strictEqual(second, profile, `profile resolution should reuse frozen canonical object for ${zone.id}`);
	}
	assert.equal(resolveBiomeAssetProfileForZone('not-a-real-zone'), null);
}

function checkDeterministicArchitectureSelection() {
	for (const profileId of EXPECTED_PROFILE_IDS) {
		const first = selectRegionalArchitectureAsset(profileId, 123456, null);
		const second = selectRegionalArchitectureAsset(profileId, 123456, null);
		assert.deepEqual(second, first, `architecture selection changed for ${profileId}`);
		assert.ok(first?.asset, `architecture asset missing for ${profileId}`);
		const restricted = selectRegionalArchitectureAsset(profileId, 123456, first?.role || null);
		assert.ok(restricted?.asset, `role-filtered architecture missing for ${profileId}`);
	}
	assert.equal(selectRegionalArchitectureAsset('missing', 1), null);
}

function checkDensitySemantics() {
	const cases = [
		['lush', 100, 0.155, 0.585],
		['desert', 100, 0.180, 0.665],
		['jungle', 100, 0.555, 0.900],
		['valyria', 100, 0.830, 0.860],
		['snow', 100, 0.145, 0.115],
	];
	for (const [profileId, base, x, y] of cases) {
		const density = computeBiomeDensityPerKm2(profileId, base, x, y);
		expectRange(density, 0, 160, `${profileId} density`);
	}
	assert.throws(() => computeBiomeDensityPerKm2('nope', 10, 0.5, 0.5), /unknown biome profile/);
}

function checkMaterialRoleSemantics() {
	const expectations = [
		['snow', 'ground', 'snow-cold'],
		['snow', 'rock', 'granite-shadow'],
		['desert', 'ground', 'warm-sand'],
		['desert', 'metal', 'oxidized-copper'],
		['jungle', 'ground', 'humid-green'],
		['valyria', 'rock', 'basalt-wet'],
	];
	for (const [profileId, role, expected] of expectations) assert.equal(classifySurfaceRole(profileId, role), expected);
	assert.equal(classifySurfaceRole('missing', 'rock'), null);
	assert.equal(classifySurfaceRole('snow', 'unknown'), null);
}

function checkFamilyCoverage() {
	const families = listBiomeAssetFamilies();
	assert.ok(families.length >= 40, `asset family taxonomy unexpectedly small: ${families.length}`);
	for (const [group, required] of Object.entries(REQUIRED_FAMILY_GROUPS)) {
		assert.ok(required.some((family) => families.includes(family)), `no family from ${group} group remains available`);
	}
	assert.ok(families.includes('snow-pine'));
	assert.ok(families.includes('basalt-outcrop'));
	assert.ok(families.includes('palm'));
	assert.ok(families.includes('reed-clump'));
}

function checkScaleDeterminism() {
	for (const profileId of ['snow', 'mountain', 'lush', 'desert', 'jungle', 'valyria']) {
		const profile = BIOME_ASSET_PROFILES[profileId];
		for (const item of profile.scatter) {
			const first = sampleAssetScale(profileId, item.family, 77);
			const second = sampleAssetScale(profileId, item.family, 77);
			assert.equal(second, first, `${profileId}:${item.family} scale is not deterministic`);
			expectRange(first, item.scaleMin, item.scaleMax, `${profileId}:${item.family} scale range`);
		}
	}
}

function checkWorldMapping() {
	const bounds = { minX: 0, maxX: 1536, minY: 0, maxY: 1024 };
	const centre = mapAssetDistributionToWorldXZ(0.5, 0.5, bounds, 1);
	assert.deepEqual(centre, { x: 0, z: 0 });
	const nw = mapAssetDistributionToWorldXZ(0, 0, bounds, 2);
	assert.deepEqual(nw, { x: -1536, z: -1024 });
	const se = mapAssetDistributionToWorldXZ(1, 1, bounds, 2);
	assert.deepEqual(se, { x: 1536, z: 1024 });
	assert.throws(() => mapAssetDistributionToWorldXZ(-0.01, 0.5, bounds, 1), /inside \[0,1\]/);
	assert.throws(() => mapAssetDistributionToWorldXZ(0.5, 0.5, bounds, 0), /metersPerMapUnit must be positive/);
}

function checkCanonicalGeometrySets() {
	assert.equal(REFERENCE_BIOME_ZONES.length, 17);
	assert.equal(REFERENCE_WATER_ZONES.length, 5);
	assert.equal(REFERENCE_RELIEF_CHAINS.length, 4);
	for (const zone of REFERENCE_BIOME_ZONES) {
		assert.ok(zone.id);
		assert.ok(zone.kind);
		expectRange(zone.center[0], 0, 1, `${zone.id} x`);
		expectRange(zone.center[1], 0, 1, `${zone.id} y`);
	}
}

function checkNoProfileMonoculture() {
	const tunicLike = new Map();
	for (const profileData of Object.values(BIOME_ASSET_PROFILES)) {
		for (const item of profileData.scatter) tunicLike.set(item.family, (tunicLike.get(item.family) || 0) + 1);
	}
	assert.ok(tunicLike.size >= 40, `scatter taxonomy is too monocultural (${tunicLike.size} families)`);
	const profileFamilyCounts = Object.fromEntries(Object.entries(BIOME_ASSET_PROFILES).map(([id, profileData]) => [id, new Set(profileData.scatter.map((item) => item.family)).size]));
	for (const [id, count] of Object.entries(profileFamilyCounts)) assert.ok(count >= 3, `${id} has too few scatter families: ${count}`);
}

function checkProfileWeights() {
	for (const [id, profileData] of Object.entries(BIOME_ASSET_PROFILES)) {
		const scatterWeight = profileData.scatter.reduce((sum, item) => sum + item.weight, 0);
		const geologyWeight = profileData.geology.reduce((sum, item) => sum + item.weight, 0);
		const architectureWeight = profileData.architecture.reduce((sum, item) => sum + item.weight, 0);
		assert.ok(scatterWeight > 0, `${id} scatter weights empty`);
		assert.ok(geologyWeight > 0, `${id} geology weights empty`);
		assert.ok(architectureWeight > 0, `${id} architecture weights empty`);
		for (const item of profileData.scatter) assert.ok(item.weight > 0 && item.densityPerKm2 >= 0, `${id}:${item.family} invalid scatter weight/density`);
		for (const item of profileData.geology) assert.ok(item.weight > 0 && item.densityPerKm2 >= 0, `${id}:${item.family} invalid geology weight/density`);
	}
}

function checkAuditFunction() {
	const audit = auditBiomeDistributionContract();
	assert.equal(audit.ok, true, audit.errors.join('\n'));
	assert.equal(audit.errors.length, 0);
	assert.equal(audit.profileCount, Object.keys(BIOME_ASSET_PROFILES).length);
	assert.ok(audit.assetFamilyCount >= 40);
	assert.equal(audit.zoneCoverage.length, REFERENCE_BIOME_ZONES.length);
}

function checkSeedDomainSeparatesSpatialSamples() {
	const centre = zoneById('reach').center;
	const samples = new Set();
	for (let i = 0; i < 12; i += 1) {
		const context = resolveBiomeAssetDistribution(centre[0], centre[1], `seed-${i}`, { sampleCount: 8 });
		samples.add(JSON.stringify(context.scatter));
	}
	assert.ok(samples.size >= 3, `seeded spatial selection collapsed to ${samples.size} scatter variants`);
}

function checkDryWorldDoesNotBecomeForest() {
	for (const zoneId of ['dorne', 'red-waste', 'grey-waste']) {
		const zone = zoneById(zoneId);
		const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'dry-audit', { sampleCount: 12 });
		const forestFamilies = new Set(['oak', 'beech', 'round-tree', 'broadleaf-tall', 'broadleaf-round']);
		const forestCount = context.scatter.filter((item) => forestFamilies.has(item.family)).length;
		assert.ok(forestCount <= 2, `${zoneId} dry profile became forest-heavy (${forestCount}/${context.scatter.length})`);
	}
}

function checkColdWorldDoesNotBecomeGreenBroadleaf() {
	for (const zoneId of ['lands-always-winter', 'north']) {
		const zone = zoneById(zoneId);
		const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'cold-audit', { sampleCount: 12 });
		const broadleaf = context.scatter.filter((item) => ['oak', 'beech', 'broadleaf-tall', 'broadleaf-round'].includes(item.family));
		assert.ok(broadleaf.length <= 1, `${zoneId} cold profile became broadleaf-heavy`);
	}
}

function checkJungleDoesNotBecomeBare() {
	for (const zoneId of ['sothoryos', 'ulthos']) {
		const zone = zoneById(zoneId);
		const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'jungle-audit', { sampleCount: 12 });
		const jungleFamilies = context.scatter.filter((item) => ['broadleaf-tall', 'broadleaf-round', 'palm', 'fern-clump'].includes(item.family));
		assert.ok(jungleFamilies.length >= 4, `${zoneId} does not retain enough jungle families`);
	}
}

function checkRockRegionsRemainRocky() {
	const candidates = [
		['vale-mountains', 'mountain'],
		['bone-mountains', 'mountain'],
		['dorne-mountains', 'mountain'],
	];
	for (const [zoneId, expectedProfile] of candidates) {
		const zone = zoneById(zoneId);
		const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'rock-audit', { sampleCount: 12 });
		assert.equal(context.profileId, expectedProfile, `${zoneId} resolved to ${context.profileId}`);
		assert.ok(context.geology.densityPerKm2 >= 5, `${zoneId} geology density collapsed`);
	}
}

function checkCoastalTransition() {
	const zone = zoneById('braavos-coast');
	const context = resolveBiomeAssetDistribution(zone.center[0], zone.center[1], 'coast-audit', { sampleCount: 12 });
	assert.ok(context.water.signal > 0, 'coastal zone lost water influence');
	assert.ok(['coast', 'temperate'].includes(context.profileId), `coastal centre unexpectedly resolved to ${context.profileId}`);
	assert.ok(context.scatter.some((item) => ['shore-boulder', 'coastal-shrub', 'wind-bent-tree', 'round-tree'].includes(item.family)));
}

function checkArchitectureTextureSignals() {
	for (const profileId of EXPECTED_PROFILE_IDS) {
		const context = resolveBiomeAssetDistribution(0.5, 0.5, `surface:${profileId}`, { sampleCount: 4 });
		const profile = BIOME_ASSET_PROFILES[profileId];
		assert.ok(profile.materialSignals.ground);
		assert.ok(profile.materialSignals.rock);
		assert.ok(profile.materialSignals.wood);
		assert.ok(profile.materialSignals.metal);
		const direct = classifySurfaceRole(profileId, 'ground');
		assert.equal(direct, profile.materialSignals.ground);
		assertBiomeDistributionConsistency(context);
	}
}

function run() {
	checkPolicyShape();
	checkRepositoryAssetCandidates();
	checkCanonicalGeometrySets();
	const centreRecords = checkCentreResolution();
	const boundarySampleCount = checkBoundarySampling();
	checkSpecialRegions();
	checkZoneProfileRoundTrip();
	checkDeterministicArchitectureSelection();
	checkDensitySemantics();
	checkMaterialRoleSemantics();
	checkFamilyCoverage();
	checkScaleDeterminism();
	checkWorldMapping();
	checkNoProfileMonoculture();
	checkProfileWeights();
	checkAuditFunction();
	checkSeedDomainSeparatesSpatialSamples();
	checkDryWorldDoesNotBecomeForest();
	checkColdWorldDoesNotBecomeGreenBroadleaf();
	checkJungleDoesNotBecomeBare();
	checkRockRegionsRemainRocky();
	checkCoastalTransition();
	checkArchitectureTextureSignals();
	const report = {
		ok: true,
		policyId: BIOME_ASSET_DISTRIBUTION_POLICY.id,
		version: BIOME_ASSET_DISTRIBUTION_POLICY.version,
		mapSha256: BIOME_ASSET_DISTRIBUTION_POLICY.sourceMapSha256,
		canonicalBiomeZones: REFERENCE_BIOME_ZONES.length,
		canonicalWaterZones: REFERENCE_WATER_ZONES.length,
		canonicalReliefChains: REFERENCE_RELIEF_CHAINS.length,
		profileCount: Object.keys(BIOME_ASSET_PROFILES).length,
		assetFamilyCount: listBiomeAssetFamilies().length,
		repositoryAssetCandidateCount: REAL_ASSET_PATHS.length,
		centreSamples: centreRecords.length,
		boundarySamples: boundarySampleCount,
		profileIds: EXPECTED_PROFILE_IDS,
		zoneProfiles: centreRecords,
	};
	console.log(JSON.stringify(report, null, 2));
	console.log('BIOME_ASSET_DISTRIBUTION_OK');
}

run();
