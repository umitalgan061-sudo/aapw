#!/usr/bin/env node

import {
	WORLD_ENVIRONMENT_RESIDENCY_POLICY,
	ENVIRONMENT_RESIDENCY_BANDS,
	ENVIRONMENT_VISUAL_TIERS,
	ENVIRONMENT_TEXTURE_TIERS,
	ENVIRONMENT_SHADOW_MODES,
	classifyEnvironmentBand,
	chunkCenterWorldXZ,
	chunkDeltaDistanceMeters,
	chebyshevChunkDistance,
	normalizeChunkKey,
	stableHash32,
	stableUnitFloat,
	stableSignedJitter,
	chunkSortScore,
	resolveTextureTier,
	resolveShadowMode,
	resolveVisualTier,
	resolveSurfaceTextureRequirements,
	buildAssetFidelityRequirements,
	validateAssetFidelityMetadata,
	familyCapacityKm2,
	familyMaxAssets,
	familySpacingMeters,
	resolveEnvironmentBudget,
	makeChunkResidencyEntry,
	planEnvironmentResidency,
	selectAssetSlot,
	buildDeterministicFamilySlots,
	environmentChunkManifest,
	validateResidencyPlan,
	compareResidencyPlans,
	computeResidentAssetBudget,
	resolveChunkMaterialDistancePreset,
	residencyStats,
	buildResidencyAuditSnapshot,
	expectedBandCounts,
} from '../src/3d/world/worldEnvironmentResidency.js';

import {
	ENVIRONMENT_SURFACE_PROFILE_POLICY,
	SURFACE_RESPONSE_CLASSES,
	ENVIRONMENT_SURFACE_PROFILES,
	getEnvironmentSurfaceProfile,
	normalizeEnvironmentSurfaceClass,
	surfaceUsesTriplanar,
	surfaceTextureChannels,
	surfaceNormalAmplitude,
	surfaceRoughness,
	surfaceLuminanceResponse,
	surfaceNormalScaleForBand,
	surfaceBlendWeights,
	recommendedEnvironmentSurfaceResponse,
	validateEnvironmentSurfaceResponse,
	validateEnvironmentSurfaceProfile,
	validateAllEnvironmentSurfaceProfiles,
	environmentSurfaceProfileDigest,
	ENVIRONMENT_SURFACE_PROFILE_DIGEST,
} from '../src/3d/world/worldEnvironmentSurfaceProfiles.js';

let assertions = 0;
let failures = 0;

function assert(condition, message) {
	assertions += 1;
	if (!condition) {
		failures += 1;
		throw new Error(message);
	}
}

function assertEqual(actual, expected, message) {
	assert(Object.is(actual, expected), `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

function assertDeepEqual(actual, expected, message) {
	assert(JSON.stringify(actual) === JSON.stringify(expected), `${message}: structural mismatch`);
}

function assertApprox(actual, expected, tolerance, message) {
	assert(Math.abs(actual - expected) <= tolerance, `${message}: ${actual} !~= ${expected} ±${tolerance}`);
}

function runCase(name, fn) {
	try {
		fn();
		console.log(`[residency] PASS ${name}`);
	} catch (error) {
		failures += 1;
		console.error(`[residency] FAIL ${name}: ${error.message}`);
	}
}

runCase('policy identity', () => {
	assertEqual(WORLD_ENVIRONMENT_RESIDENCY_POLICY.deterministic, true, 'policy must be deterministic');
	assertEqual(WORLD_ENVIRONMENT_RESIDENCY_POLICY.selectionNeverInventsGeography, true, 'selection guard');
	assertEqual(WORLD_ENVIRONMENT_RESIDENCY_POLICY.placementAuthority, 'world/WorldAssetPlacementPipeline', 'placement authority');
	assertEqual(ENVIRONMENT_SURFACE_PROFILE_POLICY.inventNewGeography, false, 'surface profiles must not invent geography');
	assertEqual(ENVIRONMENT_SURFACE_PROFILE_POLICY.assetTextureAuthority, 'shared-material-assignment-core', 'texture authority');
});

runCase('chunk coordinates', () => {
	assertEqual(normalizeChunkKey(0, 0), '0,0', 'origin key');
	assertEqual(normalizeChunkKey(-2, 4), '-2,4', 'negative key');
	assertDeepEqual(chunkCenterWorldXZ(-2, 3, 500), { x: -1000, z: 1500 }, 'chunk center');
	assertApprox(chunkDeltaDistanceMeters(-2, 3, 0, 0, 500), 1802.7756377, 0.000001, 'chunk euclidean distance');
	assertEqual(chebyshevChunkDistance(-2, 3, 0, 0), 3, 'chunk chebyshev distance');
});

runCase('band threshold edges desktop', () => {
	assertEqual(classifyEnvironmentBand(0), ENVIRONMENT_RESIDENCY_BANDS.NEAR, 'origin near');
	assertEqual(classifyEnvironmentBand(749.999), ENVIRONMENT_RESIDENCY_BANDS.NEAR, 'near upper edge');
	assertEqual(classifyEnvironmentBand(750), ENVIRONMENT_RESIDENCY_BANDS.NEAR, 'near inclusive');
	assertEqual(classifyEnvironmentBand(750.001), ENVIRONMENT_RESIDENCY_BANDS.MID, 'mid transition');
	assertEqual(classifyEnvironmentBand(1500), ENVIRONMENT_RESIDENCY_BANDS.MID, 'mid inclusive');
	assertEqual(classifyEnvironmentBand(1500.001), ENVIRONMENT_RESIDENCY_BANDS.FAR, 'far transition');
	assertEqual(classifyEnvironmentBand(3000), ENVIRONMENT_RESIDENCY_BANDS.FAR, 'far inclusive');
	assertEqual(classifyEnvironmentBand(3000.001), ENVIRONMENT_RESIDENCY_BANDS.OUTER, 'outer transition');
});

runCase('band threshold edges mobile', () => {
	assertEqual(classifyEnvironmentBand(500, { mobile: true }), ENVIRONMENT_RESIDENCY_BANDS.NEAR, 'mobile near inclusive');
	assertEqual(classifyEnvironmentBand(500.001, { mobile: true }), ENVIRONMENT_RESIDENCY_BANDS.MID, 'mobile mid transition');
	assertEqual(classifyEnvironmentBand(1000, { mobile: true }), ENVIRONMENT_RESIDENCY_BANDS.MID, 'mobile mid inclusive');
	assertEqual(classifyEnvironmentBand(1000.001, { mobile: true }), ENVIRONMENT_RESIDENCY_BANDS.FAR, 'mobile far transition');
	assertEqual(classifyEnvironmentBand(2000, { mobile: true }), ENVIRONMENT_RESIDENCY_BANDS.FAR, 'mobile far inclusive');
	assertEqual(classifyEnvironmentBand(2000.001, { mobile: true }), ENVIRONMENT_RESIDENCY_BANDS.OUTER, 'mobile outer transition');
});

runCase('stable hash reproducibility', () => {
	const first = stableHash32(1337, -4, 9, 'rock', 12);
	const second = stableHash32(1337, -4, 9, 'rock', 12);
	assertEqual(first, second, 'hash must be stable');
	assert(first !== stableHash32(1337, -4, 9, 'rock', 13), 'different slots need different hash input');
	const unit = stableUnitFloat(1337, -4, 9, 'rock', 12);
	assert(unit >= 0 && unit < 1, 'unit float range');
	const signed = stableSignedJitter(1337, -4, 9, 12);
	assert(signed >= -1 && signed <= 1, 'signed jitter range');
});

runCase('deterministic chunk sort', () => {
	const inputs = [
		[0, 0], [1, 0], [0, 1], [-1, 0], [0, -1], [2, -2], [-2, 2],
	];
	const a = inputs.map(([x, z]) => chunkSortScore({ chunkX: x, chunkZ: z, centerChunkX: 0, centerChunkZ: 0, chunkSizeMeters: 500, seed: 1337 }));
	const b = inputs.map(([x, z]) => chunkSortScore({ chunkX: x, chunkZ: z, centerChunkX: 0, centerChunkZ: 0, chunkSizeMeters: 500, seed: 1337 }));
	assertDeepEqual(a, b, 'sort score determinism');
	assert(a[0] < a[1], 'center must sort before adjacent chunk');
});

runCase('texture tier monotonicity', () => {
	const near = resolveTextureTier({ band: 'near', quality: 'ultra' });
	const far = resolveTextureTier({ band: 'far', quality: 'ultra' });
	const low = resolveTextureTier({ band: 'near', quality: 'low' });
	const mobileNear = resolveTextureTier({ band: 'near', quality: 'ultra', mobile: true });
	assertEqual(near, ENVIRONMENT_TEXTURE_TIERS.ULTRA, 'ultra near tier');
	assert(far !== ENVIRONMENT_TEXTURE_TIERS.ULTRA, 'far tier must shed highest texture budget');
	assert(low === ENVIRONMENT_TEXTURE_TIERS.LOW || low === ENVIRONMENT_TEXTURE_TIERS.MEDIUM, 'low quality tier');
	assert(mobileNear !== ENVIRONMENT_TEXTURE_TIERS.ULTRA, 'mobile tier must shed ultra textures');
});

runCase('shadow modes respect band and quality', () => {
	assertEqual(resolveShadowMode({ band: 'near', quality: 'ultra', mobile: false }), ENVIRONMENT_SHADOW_MODES.FULL, 'desktop hero shadow');
	assertEqual(resolveShadowMode({ band: 'far', quality: 'ultra', mobile: false }), ENVIRONMENT_SHADOW_MODES.OFF, 'far shadows off');
	assertEqual(resolveShadowMode({ band: 'near', quality: 'low', mobile: true }), ENVIRONMENT_SHADOW_MODES.CONTACT_ONLY, 'mobile near contact shadows');
	assertEqual(resolveShadowMode({ band: 'outer', quality: 'high', mobile: false }), ENVIRONMENT_SHADOW_MODES.OFF, 'outer shadows off');
});

runCase('visual tier responds to surface context', () => {
	assertEqual(resolveVisualTier({ band: 'near', assetFamily: 'tree' }), ENVIRONMENT_VISUAL_TIERS.FULL, 'near tree full');
	assertEqual(resolveVisualTier({ band: 'outer', assetFamily: 'tree' }), ENVIRONMENT_VISUAL_TIERS.BOUNDARY, 'outer boundary');
	assertEqual(resolveVisualTier({ band: 'mid', assetFamily: 'cliff', surfaceContext: { slopeDegrees: 70 } }), ENVIRONMENT_VISUAL_TIERS.FULL, 'steep cliff keeps detail');
	assertEqual(resolveVisualTier({ band: 'mid', assetFamily: 'prop', surfaceContext: { waterDistanceMeters: 8 } }), ENVIRONMENT_VISUAL_TIERS.FULL, 'shore props retain detail');
});

runCase('surface channel contracts', () => {
	for (const surface of ['grass', 'soil', 'mud', 'rock', 'scree', 'snow', 'wet', 'bark', 'leaves', 'wall', 'roof', 'metal']) {
		const requirements = resolveSurfaceTextureRequirements(surface);
		assertEqual(requirements.albedo, true, `${surface} albedo`);
		assertEqual(requirements.normal, true, `${surface} normal`);
		assertEqual(requirements.roughness, true, `${surface} roughness`);
	}
	assertEqual(surfaceUsesTriplanar('rock'), true, 'rock triplanar');
	assertEqual(surfaceUsesTriplanar('roof'), false, 'roof UV material');
	assertDeepEqual(surfaceTextureChannels('snow'), { albedo: true, normal: true, roughness: true, ao: false }, 'snow channels');
});

runCase('asset fidelity rejects missing PBR', () => {
	const requirements = buildAssetFidelityRequirements({ family: 'rock', surfaceClass: 'rock', quality: 'high', band: 'near' });
	const missing = validateAssetFidelityMetadata({ materialSlotCount: 1, hasAlbedo: true, hasNormal: false, hasRoughness: false }, requirements);
	assertEqual(missing.valid, false, 'missing channels must fail');
	assert(missing.reasons.includes('missing-normal'), 'normal failure reason');
	assert(missing.reasons.includes('missing-roughness'), 'roughness failure reason');
});

runCase('asset fidelity rejects placeholders and single-color models', () => {
	const requirements = buildAssetFidelityRequirements({ family: 'tree', surfaceClass: 'bark', quality: 'high', band: 'near' });
	const bad = validateAssetFidelityMetadata({ materialSlotCount: 2, hasAlbedo: true, hasNormal: true, hasRoughness: true, placeholder: true, singleColor: true }, requirements);
	assertEqual(bad.valid, false, 'placeholder must fail');
	assert(bad.reasons.includes('placeholder-material'), 'placeholder reason');
	assert(bad.reasons.includes('single-color-material'), 'single color reason');
});

runCase('asset fidelity accepts valid imported material metadata', () => {
	const requirements = buildAssetFidelityRequirements({ family: 'tree', surfaceClass: 'leaves', quality: 'high', band: 'near' });
	const good = validateAssetFidelityMetadata({ materialSlotCount: 2, hasAlbedo: true, hasNormal: true, hasRoughness: true, maxTextureResolution: 2048 }, requirements);
	assertEqual(good.valid, true, 'valid PBR metadata');
	assert(good.distinctPBRChannels >= 3, 'distinct channel count');
});

runCase('family budget decreases with distance', () => {
	const near = familyCapacityKm2({ family: 'tree', band: 'near', quality: 'high' });
	const mid = familyCapacityKm2({ family: 'tree', band: 'mid', quality: 'high' });
	const far = familyCapacityKm2({ family: 'tree', band: 'far', quality: 'high' });
	assert(near > mid && mid > far, 'tree density should decrease outward');
	const nearMax = familyMaxAssets({ family: 'rock', band: 'near', quality: 'high' });
	const farMax = familyMaxAssets({ family: 'rock', band: 'far', quality: 'high' });
	assert(nearMax > farMax, 'rock max assets should decrease outward');
	const nearSpacing = familySpacingMeters({ family: 'rock', band: 'near', quality: 'high' });
	const farSpacing = familySpacingMeters({ family: 'rock', band: 'far', quality: 'high' });
	assert(farSpacing > nearSpacing, 'far spacing should increase');
});

runCase('mobile budget is bounded', () => {
	const desktop = resolveEnvironmentBudget({ family: 'vegetation', band: 'near', quality: 'high', mobile: false });
	const mobile = resolveEnvironmentBudget({ family: 'vegetation', band: 'near', quality: 'high', mobile: true });
	assert(mobile.maxAssets <= desktop.maxAssets, 'mobile max assets should not exceed desktop');
	assert(mobile.densityPerKm2 <= desktop.densityPerKm2, 'mobile density should not exceed desktop');
	assert(mobile.spacingMeters >= desktop.spacingMeters, 'mobile spacing should not be tighter than desktop');
});

runCase('biome density multiplier remains bounded', () => {
	const zero = resolveEnvironmentBudget({ family: 'rock', band: 'near', biomeDensityMultiplier: 0 });
	const normal = resolveEnvironmentBudget({ family: 'rock', band: 'near', biomeDensityMultiplier: 1 });
	const capped = resolveEnvironmentBudget({ family: 'rock', band: 'near', biomeDensityMultiplier: 999 });
	assertEqual(zero.maxAssets, 0, 'zero density multiplier');
	assert(capped.maxAssets <= normal.maxAssets * 2, 'density cap');
});

runCase('entry contains deterministic geographic coordinates only', () => {
	const entry = makeChunkResidencyEntry({ chunkX: -3, chunkZ: 4, centerChunkX: 0, centerChunkZ: 0, chunkSizeMeters: 500, seed: 1337, quality: 'high', mobile: false });
	assertEqual(entry.key, '-3,4', 'entry key');
	assertEqual(entry.centerWorldXZ.x, -1500, 'entry x');
	assertEqual(entry.centerWorldXZ.z, 2000, 'entry z');
	assert(Number.isFinite(entry.distanceMeters), 'entry distance');
	assert(entry.assetBudgets.rock.requirements.singleColorMaterialForbidden, 'rock single-color guard');
});

runCase('residency plan covers exact square', () => {
	const plan = planEnvironmentResidency({ centerChunkX: 0, centerChunkZ: 0, radiusChunks: 2, chunkSizeMeters: 500, seed: 1337, quality: 'high' });
	assertEqual(plan.entries.length, 25, 'radius 2 square count');
	assertEqual(plan.residentChunkCount, 25, 'resident count');
	assertDeepEqual(validateResidencyPlan(plan), { valid: true, reasons: [] }, 'plan validation');
});

runCase('residency plan is deterministic byte-for-byte', () => {
	const a = planEnvironmentResidency({ centerChunkX: 4, centerChunkZ: -2, radiusChunks: 3, chunkSizeMeters: 500, seed: 1337, quality: 'medium', mobile: true });
	const b = planEnvironmentResidency({ centerChunkX: 4, centerChunkZ: -2, radiusChunks: 3, chunkSizeMeters: 500, seed: 1337, quality: 'medium', mobile: true });
	assertDeepEqual(compareResidencyPlans(a, b), { same: true, reasons: [] }, 'plan determinism');
});

runCase('seed and center alter plan without changing contract', () => {
	const a = planEnvironmentResidency({ centerChunkX: 0, centerChunkZ: 0, radiusChunks: 2, chunkSizeMeters: 500, seed: 1337 });
	const b = planEnvironmentResidency({ centerChunkX: 1, centerChunkZ: 0, radiusChunks: 2, chunkSizeMeters: 500, seed: 1337 });
	const c = planEnvironmentResidency({ centerChunkX: 0, centerChunkZ: 0, radiusChunks: 2, chunkSizeMeters: 500, seed: 42 });
	assert(compareResidencyPlans(a, b).same === false, 'center should change plan');
	assert(a.entries.length === c.entries.length, 'seed changes should preserve topology');
});

runCase('family slots are deterministic and bounded', () => {
	const a = buildDeterministicFamilySlots({ seed: 1337, chunkX: 3, chunkZ: -2, family: 'tree', requestedCount: 32, candidateCount: 4, acceptance: 0.8 });
	const b = buildDeterministicFamilySlots({ seed: 1337, chunkX: 3, chunkZ: -2, family: 'tree', requestedCount: 32, candidateCount: 4, acceptance: 0.8 });
	assertDeepEqual(a, b, 'slot determinism');
	assert(a.length <= 32, 'slot upper bound');
	for (const slot of a) assert(slot.candidateIndex >= 0 && slot.candidateIndex < 4, 'candidate range');
	assert(selectAssetSlot({ seed: 1337, chunkX: 3, chunkZ: -2, family: 'tree', slotIndex: 0, candidateCount: 4, acceptance: 0 }) === -1, 'zero acceptance');
});

runCase('chunk manifest exposes budget without selection authority', () => {
	const entry = makeChunkResidencyEntry({ chunkX: 0, chunkZ: 0, centerChunkX: 0, centerChunkZ: 0, seed: 1337, quality: 'high' });
	const manifest = environmentChunkManifest(entry);
	assertEqual(manifest.policyId, WORLD_ENVIRONMENT_RESIDENCY_POLICY.id, 'manifest policy');
	assertEqual(manifest.chunkKey, '0,0', 'manifest key');
	assert(Array.isArray(manifest.families), 'manifest families');
	assert(manifest.families.some((family) => family.family === 'rock'), 'rock family manifest');
	assert(!('assetPath' in manifest), 'manifest must not select a concrete asset');
});

runCase('resident aggregate is deterministic', () => {
	const plan = planEnvironmentResidency({ centerChunkX: 0, centerChunkZ: 0, radiusChunks: 3, seed: 1337 });
	const totals = computeResidentAssetBudget(plan);
	const stats = residencyStats(plan);
	assert(Object.keys(totals).length > 3, 'family totals');
	assertEqual(stats.near, 5, 'radius3 near band count');
	assert(stats.maxAssets > 0, 'aggregate max assets');
});

runCase('expected band counts agree with generated plan topology', () => {
	for (const radius of [1, 2, 3, 4]) {
		const expected = expectedBandCounts(radius, 500, { mobile: false });
		const plan = planEnvironmentResidency({ radiusChunks: radius, chunkSizeMeters: 500 });
		const actual = residencyStats(plan);
		assertEqual(actual.near, expected.near, `desktop near count r${radius}`);
		assertEqual(actual.mid, expected.mid, `desktop mid count r${radius}`);
		assertEqual(actual.far, expected.far, `desktop far count r${radius}`);
		assertEqual(actual.outer, expected.outer, `desktop outer count r${radius}`);
	}
});

runCase('mobile band topology remains deterministic', () => {
	for (const radius of [2, 3, 4]) {
		const expected = expectedBandCounts(radius, 500, { mobile: true });
		const plan = planEnvironmentResidency({ radiusChunks: radius, chunkSizeMeters: 500, mobile: true });
		const actual = residencyStats(plan);
		assertEqual(actual.near, expected.near, `mobile near count r${radius}`);
		assertEqual(actual.mid, expected.mid, `mobile mid count r${radius}`);
		assertEqual(actual.far, expected.far, `mobile far count r${radius}`);
		assertEqual(actual.outer, expected.outer, `mobile outer count r${radius}`);
	}
});

runCase('material distance preset is smooth and bounded', () => {
	const near = resolveChunkMaterialDistancePreset({ band: 'near', quality: 'high' });
	const mid = resolveChunkMaterialDistancePreset({ band: 'mid', quality: 'high' });
	const far = resolveChunkMaterialDistancePreset({ band: 'far', quality: 'high' });
	assert(near.normalScale > mid.normalScale && mid.normalScale > far.normalScale, 'normal scale decreases with distance');
	assert(near.roughnessBias <= mid.roughnessBias && mid.roughnessBias <= far.roughnessBias, 'roughness bias increases with distance');
	assert(near.receiveShadow === true && far.receiveShadow === false, 'shadow transition');
	assert(near.castShadow === false && mid.castShadow === false && far.castShadow === false, 'terrain never casts environment shadows');
});

runCase('audit snapshot is machine-readable', () => {
	const plan = planEnvironmentResidency({ radiusChunks: 2, seed: 1337, quality: 'high' });
	const audit = buildResidencyAuditSnapshot({ plan, frameId: 41, cameraWorld: { x: 250, z: -500 } });
	assertEqual(audit.frameId, 41, 'frame id');
	assertDeepEqual(audit.cameraWorld, { x: 250, z: -500 }, 'camera snapshot');
	assertEqual(audit.validation.valid, true, 'audit plan validity');
	assert(audit.residentAssetBudget.tree > 0, 'tree budget');
});

runCase('surface classes normalize without inventing a class', () => {
	assertEqual(normalizeEnvironmentSurfaceClass('boulder'), 'rock', 'boulder alias');
	assertEqual(normalizeEnvironmentSurfaceClass('wet shoreline'), 'waterline', 'shore alias');
	assertEqual(normalizeEnvironmentSurfaceClass('unknown surface family'), 'wall', 'safe fallback');
	assert(getEnvironmentSurfaceProfile('boulder') === getEnvironmentSurfaceProfile('rock'), 'alias profile');
});

runCase('surface numeric responses are finite', () => {
	for (const surface of Object.keys(ENVIRONMENT_SURFACE_PROFILES)) {
		const amplitude = surfaceNormalAmplitude(surface, { detail: 0.7, distanceFactor: 0.5 });
		const roughness = surfaceRoughness(surface, { moisture: 0.65, detail: 0.6 });
		const luminance = surfaceLuminanceResponse(surface, { moisture: 0.65, macro: -0.4 });
		const normalScale = surfaceNormalScaleForBand(surface, 0.7);
		assert(Number.isFinite(amplitude) && amplitude > 0, `${surface} normal amplitude`);
		assert(Number.isFinite(roughness) && roughness >= 0 && roughness <= 1, `${surface} roughness`);
		assert(Number.isFinite(luminance) && luminance >= 0 && luminance <= 1, `${surface} luminance`);
		assert(Number.isFinite(normalScale) && normalScale > 0, `${surface} normal scale`);
	}
});

runCase('surface blend response is bounded', () => {
	for (const surface of Object.keys(ENVIRONMENT_SURFACE_PROFILES)) {
		const blend = surfaceBlendWeights(surface, { slopeDegrees: 42, moisture: 0.75, heightMeters: 900, waterDistanceMeters: 12 });
		for (const key of ['base', 'wetBoost', 'waterBoost', 'heightFade', 'slopeFade']) {
			assert(blend[key] >= 0 && blend[key] <= 1, `${surface} ${key} bound`);
		}
	}
});

runCase('recommended surface response validates', () => {
	for (const surface of Object.keys(ENVIRONMENT_SURFACE_PROFILES)) {
		const response = recommendedEnvironmentSurfaceResponse(surface, { moisture: 0.4, macroSignal: -0.25, distanceFactor: 0.8, detailFactor: 0.9 });
		assertDeepEqual(validateEnvironmentSurfaceResponse(response), { valid: true, reasons: [] }, `${surface} response validation`);
	}
});

runCase('every authored surface profile validates', () => {
	const report = validateAllEnvironmentSurfaceProfiles();
	assertEqual(report.valid, true, 'all surface profiles');
	assertEqual(report.failures.length, 0, 'no surface profile failures');
});

runCase('surface profile digest stable', () => {
	assertEqual(environmentSurfaceProfileDigest(), ENVIRONMENT_SURFACE_PROFILE_DIGEST, 'surface profile digest');
	assert(ENVIRONMENT_SURFACE_PROFILE_DIGEST.startsWith(ENVIRONMENT_SURFACE_PROFILE_POLICY.id), 'digest prefix');
});

runCase('family-specific surface companion behavior remains differentiated', () => {
	const grass = resolveEnvironmentBudget({ family: 'grass', band: 'near', quality: 'high', surfaceContext: { surfaceClass: 'grass' } });
	const rock = resolveEnvironmentBudget({ family: 'rock', band: 'near', quality: 'high', surfaceContext: { surfaceClass: 'rock', slopeDegrees: 70 } });
	assert(grass.requirements.preferTriplanar === true, 'grass uses triplanar preference');
	assert(rock.requirements.singleColorMaterialForbidden === true, 'rock PBR guard');
	assert(rock.visualTier === ENVIRONMENT_VISUAL_TIERS.FULL, 'rock near full tier');
});

runCase('negative and non-finite inputs are sanitized', () => {
	const plan = planEnvironmentResidency({ centerChunkX: Number.NaN, centerChunkZ: Number.POSITIVE_INFINITY, radiusChunks: -3, chunkSizeMeters: 0, seed: Number.NaN, quality: 'not-a-quality' });
	assertEqual(plan.centerChunkX, 0, 'center x sanitize');
	assertEqual(plan.centerChunkZ, 0, 'center z sanitize');
	assertEqual(plan.radiusChunks, 0, 'radius sanitize');
	assertEqual(plan.chunkSizeMeters, 1, 'chunk size sanitize');
	assertEqual(plan.quality, 'medium', 'quality sanitize');
	assertEqual(plan.entries.length, 1, 'sanitized plan still valid');
});

if (failures > 0) {
	console.error(`[residency] FAILURES=${failures} ASSERTIONS=${assertions}`);
	process.exit(1);
}

console.log(`[residency] PASS policy=${WORLD_ENVIRONMENT_RESIDENCY_POLICY.id} assertions=${assertions} failures=0`);
