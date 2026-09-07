#!/usr/bin/env node

import {
	buildAssetFidelityRequirements,
	validateAssetFidelityMetadata,
	resolveSurfaceTextureRequirements,
	resolveEnvironmentBudget,
	familyMaxAssets,
	familySpacingMeters,
} from '../src/3d/world/worldEnvironmentResidency.js';

import {
	ENVIRONMENT_SURFACE_PROFILES,
	getEnvironmentSurfaceProfile,
	normalizeEnvironmentSurfaceClass,
	recommendedEnvironmentSurfaceResponse,
	validateEnvironmentSurfaceResponse,
	validateAllEnvironmentSurfaceProfiles,
} from '../src/3d/world/worldEnvironmentSurfaceProfiles.js';

let checks = 0;
let failures = 0;

function expect(condition, message) {
	checks += 1;
	if (!condition) {
		failures += 1;
		throw new Error(message);
	}
}

function caseRun(name, callback) {
	try {
		callback();
		console.log(`[asset-fidelity] PASS ${name}`);
	} catch (error) {
		console.error(`[asset-fidelity] FAIL ${name}: ${error.message}`);
	}
}

const FAMILY_SURFACE_MATRIX = Object.freeze([
	['vegetation', 'leaves'],
	['tree', 'bark'],
	['shrub', 'leaves'],
	['grass', 'grass'],
	['rock', 'rock'],
	['cliff', 'rock'],
	['prop', 'metal'],
	['settlement', 'wall'],
	['bridge', 'wood'],
]);

const VALID_CHANNEL_MATRIX = Object.freeze([
	{ materialSlotCount: 1, hasAlbedo: true, hasNormal: true, hasRoughness: true, hasAO: true, maxTextureResolution: 2048 },
	{ materialSlotCount: 3, textureChannels: { albedo: true, normal: true, roughness: true }, maxTextureResolution: 4096 },
]);

caseRun('all canonical surface profiles validate', () => {
	const report = validateAllEnvironmentSurfaceProfiles();
	expect(report.valid, `surface failures: ${report.failures.join(', ')}`);
	expect(report.failures.length === 0, 'surface failures must be empty');
});

caseRun('family-to-surface matrix has explicit PBR requirements', () => {
	for (const [family, surface] of FAMILY_SURFACE_MATRIX) {
		const requirements = buildAssetFidelityRequirements({ family, surfaceClass: surface, quality: 'high', band: 'near' });
		expect(requirements.requireAlbedo, `${family} albedo requirement`);
		expect(requirements.requireNormal, `${family} normal requirement`);
		expect(requirements.requireRoughness, `${family} roughness requirement`);
		expect(requirements.singleColorMaterialForbidden, `${family} single-color guard`);
	}
});

caseRun('valid material fixtures pass', () => {
	for (const [family, surface] of FAMILY_SURFACE_MATRIX) {
		const requirements = buildAssetFidelityRequirements({ family, surfaceClass: surface, quality: 'high', band: 'near' });
		for (const fixture of VALID_CHANNEL_MATRIX) {
			const result = validateAssetFidelityMetadata(fixture, requirements);
			expect(result.valid, `${family}/${surface} valid fixture should pass`);
		}
	}
});

caseRun('one-channel removals fail appropriately', () => {
	for (const [family, surface] of FAMILY_SURFACE_MATRIX) {
		const requirements = buildAssetFidelityRequirements({ family, surfaceClass: surface, quality: 'high', band: 'near' });
		const missingNormal = validateAssetFidelityMetadata({ materialSlotCount: 1, hasAlbedo: true, hasNormal: false, hasRoughness: true, hasAO: true, maxTextureResolution: 2048 }, requirements);
		expect(!missingNormal.valid, `${family} missing normal`);
		expect(missingNormal.reasons.includes('missing-normal'), `${family} normal reason`);
		const missingRoughness = validateAssetFidelityMetadata({ materialSlotCount: 1, hasAlbedo: true, hasNormal: true, hasRoughness: false, hasAO: true, maxTextureResolution: 2048 }, requirements);
		expect(!missingRoughness.valid, `${family} missing roughness`);
		expect(missingRoughness.reasons.includes('missing-roughness'), `${family} roughness reason`);
	}
});

caseRun('placeholder and single-color fixtures fail', () => {
	for (const [family, surface] of FAMILY_SURFACE_MATRIX) {
		const requirements = buildAssetFidelityRequirements({ family, surfaceClass: surface, quality: 'high', band: 'near' });
		const result = validateAssetFidelityMetadata({ materialSlotCount: 2, hasAlbedo: true, hasNormal: true, hasRoughness: true, placeholder: true, singleColor: true }, requirements);
		expect(!result.valid, `${family} placeholder`);
		expect(result.reasons.includes('placeholder-material'), `${family} placeholder reason`);
		expect(result.reasons.includes('single-color-material'), `${family} color reason`);
	}
});

caseRun('low-resolution textures fail only at tiers that require more', () => {
	const high = buildAssetFidelityRequirements({ family: 'rock', surfaceClass: 'rock', quality: 'high', band: 'near' });
	const far = buildAssetFidelityRequirements({ family: 'rock', surfaceClass: 'rock', quality: 'high', band: 'far' });
	const highResult = validateAssetFidelityMetadata({ materialSlotCount: 1, hasAlbedo: true, hasNormal: true, hasRoughness: true, maxTextureResolution: 512 }, high);
	const farResult = validateAssetFidelityMetadata({ materialSlotCount: 1, hasAlbedo: true, hasNormal: true, hasRoughness: true, maxTextureResolution: 512 }, far);
	expect(!highResult.valid, 'near high tier should reject 512 texture');
	expect(farResult.valid, 'far tier may accept 512 texture');
});

caseRun('family budget remains non-negative across quality bands', () => {
	for (const family of ['vegetation', 'tree', 'shrub', 'grass', 'rock', 'cliff', 'prop', 'settlement', 'bridge']) {
		for (const band of ['near', 'mid', 'far', 'outer']) {
			for (const quality of ['ultra', 'high', 'medium', 'low']) {
				const budget = resolveEnvironmentBudget({ family, band, quality, mobile: false });
				expect(budget.maxAssets >= 0, `${family}/${band}/${quality} max assets`);
				expect(budget.densityPerKm2 >= 0, `${family}/${band}/${quality} density`);
				expect(budget.spacingMeters > 0, `${family}/${band}/${quality} spacing`);
			}
		}
	}
});

caseRun('family budget decreases outwards for every environment family', () => {
	for (const family of ['vegetation', 'tree', 'shrub', 'grass', 'rock', 'cliff', 'prop', 'settlement', 'bridge']) {
		const values = ['near', 'mid', 'far', 'outer'].map((band) => familyMaxAssets({ family, band, quality: 'high', mobile: false }));
		for (let i = 1; i < values.length; i += 1) expect(values[i] <= values[i - 1], `${family} outer budget must not increase`);
	}
});

caseRun('family spacing increases or stays stable outwards', () => {
	for (const family of ['vegetation', 'tree', 'shrub', 'grass', 'rock', 'cliff', 'prop', 'settlement', 'bridge']) {
		const values = ['near', 'mid', 'far', 'outer'].map((band) => familySpacingMeters({ family, band, quality: 'high', mobile: false }));
		for (let i = 1; i < values.length; i += 1) expect(values[i] >= values[i - 1], `${family} outer spacing must not tighten`);
	}
});

caseRun('surface aliases resolve without synthetic taxonomy', () => {
	const aliases = [
		['boulder', 'rock'],
		['granite rock', 'rock'],
		['shoreline mud', 'mud'],
		['snow field', 'snow'],
		['tree trunk', 'bark'],
		['foliage canopy', 'leaves'],
		['slate roof', 'roof'],
		['weathered metal', 'metal'],
	];
	for (const [input, expected] of aliases) expect(normalizeEnvironmentSurfaceClass(input) === expected, `${input} alias`);
});

caseRun('surface response has physically bounded scalar outputs', () => {
	for (const surface of Object.keys(ENVIRONMENT_SURFACE_PROFILES)) {
		for (const moisture of [0, 0.25, 0.5, 0.75, 1]) {
			const response = recommendedEnvironmentSurfaceResponse(surface, { moisture, macroSignal: -0.4, distanceFactor: 0.8, detailFactor: 0.9, slopeDegrees: 28, heightMeters: 900, waterDistanceMeters: 14 });
			const validation = validateEnvironmentSurfaceResponse(response);
			expect(validation.valid, `${surface} response at moisture ${moisture}`);
			expect(response.luminance >= 0 && response.luminance <= 1, `${surface} luminance`);
			expect(response.roughness >= 0 && response.roughness <= 1, `${surface} roughness`);
			expect(response.normalScale > 0 && response.normalScale <= 1.5, `${surface} normal scale`);
		}
	}
});

caseRun('surface requirements agree with profile channels', () => {
	for (const surface of Object.keys(ENVIRONMENT_SURFACE_PROFILES)) {
		const profile = getEnvironmentSurfaceProfile(surface);
		const requirements = resolveSurfaceTextureRequirements(surface);
		expect(requirements.albedo === profile.textureChannels.albedo, `${surface} albedo channel mismatch`);
		expect(requirements.normal === profile.textureChannels.normal, `${surface} normal channel mismatch`);
		expect(requirements.roughness === profile.textureChannels.roughness, `${surface} roughness channel mismatch`);
	}
});

caseRun('settlement and bridge require stricter texture ownership', () => {
	const settlement = buildAssetFidelityRequirements({ family: 'settlement', surfaceClass: 'wall', quality: 'high', band: 'near' });
	const bridge = buildAssetFidelityRequirements({ family: 'bridge', surfaceClass: 'wood', quality: 'high', band: 'near' });
	expect(settlement.allowProceduralFallback === false, 'settlement must not silently procedural-fallback');
	expect(bridge.allowProceduralFallback === false, 'bridge must not silently procedural-fallback');
});

if (failures > 0) {
	console.error(`[asset-fidelity] FAILURES=${failures} CHECKS=${checks}`);
	process.exit(1);
}

console.log(`[asset-fidelity] PASS policy=${ENVIRONMENT_SURFACE_PROFILE_POLICY} checks=${checks} failures=0`);
