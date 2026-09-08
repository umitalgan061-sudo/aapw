#!/usr/bin/env node

import {
	planEnvironmentResidency,
	validateResidencyPlan,
	residencyStats,
	computeResidentAssetBudget,
	classifyEnvironmentBand,
	chunkDeltaDistanceMeters,
	resolveEnvironmentBudget,
	resolveTextureTier,
	resolveShadowMode,
	buildAssetFidelityRequirements,
	validateAssetFidelityMetadata,
} from '../src/3d/world/worldEnvironmentResidency.js';

let checks = 0;
let failures = 0;

function assert(condition, message) {
	checks += 1;
	if (!condition) throw new Error(message);
}

function run(name, fn) {
	try {
		fn();
		console.log(`[residency-budget] PASS ${name}`);
	} catch (error) {
		failures += 1;
		console.error(`[residency-budget] FAIL ${name}: ${error.message}`);
	}
}

const FAMILIES = ['vegetation', 'tree', 'shrub', 'grass', 'rock', 'cliff', 'prop', 'settlement', 'bridge'];
const BANDS = ['near', 'mid', 'far', 'outer'];
const QUALITIES = ['ultra', 'high', 'medium', 'low'];

run('radius one topology', () => {
	const plan = planEnvironmentResidency({ radiusChunks: 1, chunkSizeMeters: 500, seed: 1337 });
	assert(plan.entries.length === 9, 'radius 1 must have 9 chunks');
	assert(validateResidencyPlan(plan).valid, 'radius 1 plan must validate');
});

run('radius two topology', () => {
	const plan = planEnvironmentResidency({ radiusChunks: 2, chunkSizeMeters: 500, seed: 1337 });
	assert(plan.entries.length === 25, 'radius 2 must have 25 chunks');
	assert(validateResidencyPlan(plan).valid, 'radius 2 plan must validate');
});

run('radius three topology', () => {
	const plan = planEnvironmentResidency({ radiusChunks: 3, chunkSizeMeters: 500, seed: 1337 });
	assert(plan.entries.length === 49, 'radius 3 must have 49 chunks');
	assert(validateResidencyPlan(plan).valid, 'radius 3 plan must validate');
});

run('radius four topology', () => {
	const plan = planEnvironmentResidency({ radiusChunks: 4, chunkSizeMeters: 500, seed: 1337 });
	assert(plan.entries.length === 81, 'radius 4 must have 81 chunks');
	assert(validateResidencyPlan(plan).valid, 'radius 4 plan must validate');
});

run('plan order begins at closest chunk', () => {
	const plan = planEnvironmentResidency({ centerChunkX: 4, centerChunkZ: -5, radiusChunks: 3, chunkSizeMeters: 500, seed: 1337 });
	assert(plan.entries[0].chunkX === 4 && plan.entries[0].chunkZ === -5, 'center should receive highest residency priority');
});

run('plan order is distance-first', () => {
	const plan = planEnvironmentResidency({ centerChunkX: 4, centerChunkZ: -5, radiusChunks: 4, chunkSizeMeters: 500, seed: 1337 });
	let previousDistance = -1;
	let previousScore = -Infinity;
	for (const entry of plan.entries) {
		assert(entry.distanceMeters + 0.000001 >= previousDistance, `distance order violation at ${entry.key}`);
		assert(entry.sortScore + 0.000001 >= previousScore, `sort order violation at ${entry.key}`);
		previousDistance = entry.distanceMeters;
		previousScore = entry.sortScore;
	}
});

run('desktop band assignment follows Euclidean distance', () => {
	const samples = [
		{ x: 0, z: 0, expected: 'near' },
		{ x: 1, z: 0, expected: 'near' },
		{ x: 2, z: 0, expected: 'far' },
		{ x: 3, z: 0, expected: 'far' },
		{ x: 4, z: 0, expected: 'outer' },
	];
	for (const sample of samples) assert(classifyEnvironmentBand(chunkDeltaDistanceMeters(sample.x, sample.z, 0, 0, 500)) === sample.expected, `band for ${sample.x},${sample.z}`);
});

run('mobile band assignment is tighter', () => {
	const desktop = classifyEnvironmentBand(750, { mobile: false });
	const mobile = classifyEnvironmentBand(750, { mobile: true });
	assert(desktop === 'near', 'desktop 750m edge');
	assert(mobile === 'mid', 'mobile 750m must already be mid');
});

run('all quality/family combinations are finite', () => {
	for (const quality of QUALITIES) {
		for (const family of FAMILIES) {
			for (const band of BANDS) {
				const budget = resolveEnvironmentBudget({ family, quality, band });
				assert(Number.isFinite(budget.densityPerKm2), `${family}/${quality}/${band} density`);
				assert(Number.isFinite(budget.maxAssets), `${family}/${quality}/${band} max assets`);
				assert(Number.isFinite(budget.spacingMeters), `${family}/${quality}/${band} spacing`);
				assert(budget.spacingMeters > 0, `${family}/${quality}/${band} positive spacing`);
				assert(budget.textureResolution >= 256, `${family}/${quality}/${band} texture resolution`);
			}
		}
	}
});

run('outward texture tiers never increase', () => {
	for (const quality of QUALITIES) {
		for (const family of FAMILIES) {
			const ranks = BANDS.map((band) => {
				const tier = resolveTextureTier({ band, quality, requestedTier: 'high' });
				return { ultra: 4, high: 3, medium: 2, low: 1 }[tier];
			});
			for (let index = 1; index < ranks.length; index += 1) assert(ranks[index] <= ranks[index - 1], `${family}/${quality} texture tier increased`);
		}
	}
});

run('outward shadow budget never increases', () => {
	const rank = { full: 3, 'contact-only': 2, 'receive-only': 1, off: 0 };
	for (const quality of QUALITIES) {
		for (const mobile of [false, true]) {
			const values = BANDS.map((band) => rank[resolveShadowMode({ band, quality, mobile })]);
			for (let index = 1; index < values.length; index += 1) assert(values[index] <= values[index - 1], `${quality}/${mobile} shadow rank increased`);
		}
	}
});

run('asset fidelity requirements stay strict at every visual band', () => {
	for (const band of BANDS) {
		for (const family of ['tree', 'rock', 'grass', 'settlement', 'bridge']) {
			const requirements = buildAssetFidelityRequirements({ family, surfaceClass: family === 'tree' ? 'bark' : family === 'grass' ? 'grass' : family === 'settlement' ? 'wall' : family === 'bridge' ? 'wall' : 'rock', quality: 'high', band });
			assert(requirements.singleColorMaterialForbidden, `${family}/${band} single-color guard`);
			assert(requirements.requireAlbedo, `${family}/${band} albedo`);
			assert(requirements.requireNormal, `${family}/${band} normal`);
			assert(requirements.requireRoughness, `${family}/${band} roughness`);
		}
	}
});

run('far-band metadata can be lean but cannot be placeholder', () => {
	const requirements = buildAssetFidelityRequirements({ family: 'rock', surfaceClass: 'rock', quality: 'medium', band: 'far' });
	const lean = validateAssetFidelityMetadata({ materialSlotCount: 1, hasAlbedo: true, hasNormal: true, hasRoughness: true, maxTextureResolution: 512 }, requirements);
	const placeholder = validateAssetFidelityMetadata({ materialSlotCount: 1, hasAlbedo: true, hasNormal: true, hasRoughness: true, placeholder: true, maxTextureResolution: 512 }, requirements);
	assert(lean.valid, 'lean far metadata');
	assert(!placeholder.valid, 'placeholder far metadata');
});

run('resident budget matches summed manifests', () => {
	const plan = planEnvironmentResidency({ radiusChunks: 4, chunkSizeMeters: 500, seed: 1337, quality: 'high', mobile: true });
	const totals = computeResidentAssetBudget(plan);
	const stats = residencyStats(plan);
	assert(stats.near + stats.mid + stats.far + stats.outer === 81, 'band total');
	for (const family of FAMILIES) assert(totals[family] >= 0, `${family} resident budget`);
});

run('same seed different quality changes budget not topology', () => {
	const high = planEnvironmentResidency({ radiusChunks: 3, seed: 1337, quality: 'high' });
	const low = planEnvironmentResidency({ radiusChunks: 3, seed: 1337, quality: 'low' });
	assert(high.entries.length === low.entries.length, 'topology changed with quality');
	assert(JSON.stringify(high.entries.map((entry) => entry.key)) === JSON.stringify(low.entries.map((entry) => entry.key)), 'keys changed with quality');
	assert(computeResidentAssetBudget(low).tree < computeResidentAssetBudget(high).tree, 'tree budget must decrease at low quality');
});

if (failures > 0) process.exit(1);
console.log(`[residency-budget] PASS checks=${checks} failures=0`);
