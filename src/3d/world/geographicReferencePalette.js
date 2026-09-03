/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v100-natural-lowland-value-separation',
	renderOnly: true,
	deterministic: true,
	heightAuthorityUnchanged: true,
	hydrologyAuthorityUnchanged: true,
	routeAuthorityUnchanged: true,
	ecotoneContrastRaised: true,
	wetDryValueSeparationRaised: true,
	rockValueCompressionReduced: true,
	waterDepthHierarchyRaised: true,
	aerialChromaRecovery: true,
	aerialLowlandMaterialSeparationRaised: true,
	aerialLowlandDepthRaised: true,
	aerialRockSoilSeparationRaised: true,
	aerialLithologyDepthRaised: true,
	openWaterValueSeparationRaised: true,
	coastalGreenCastReduced: true,
	deepMarineBlackCrushReduced: true,
	legacyRoadBaseContractPreserved: true,
	exposedRockSeparationRaised: true,
	fullWorldLowlandStrataRaised: true,
	lowlandEcotoneDepthRaised: true,
	lowlandOliveCompressionReduced: true,
	mineralVegetationHueSeparationRaised: true,
	aerialEcologicalContrastRaised: true,
	lowlandChromaDepthRaised: true,
	weatheredLithologySeparationRaised: true,
	fullWorldLowlandMaterialSeparationRaised: true,
	lowlandAerialValueDecorrelationRaised: true,
	aerialStructuralContrastRaised: true,
	lowlandAerialRecoveryRaised: true,
	lowlandEcotoneRecoveryRaised: true,
	fullWorldVegetationReadabilityRaised: true,
	aerialEcotoneClarityRaised: true,
	fullWorldLowlandDomainRecoveryRaised: true,
	lowlandBiomeDomainSeparationRaised: true,
	fullWorldLowlandValueSeparationRaised: true,
	directionalDomainReadabilityRaised: true,
	materialDomainDepthRaised: true,
	wetLithicSeparationRaised: true,
	lowlandAerialDomainContrastRaised: true,
	lowlandDistanceReadabilityRaised: true,
	aerialMaterialContrastRaised: true,
	fullWorldDomainClarityRaised: true,
	naturalPigmentCalibration: true,
	highDistanceChannelExtremesReduced: true,
	coastalCyanBalanceRaised: true,
	naturalLowlandValueSeparationRaised: true,
	wetVegetationShadowDepthRaised: true,
	dryMineralHighlightSeparationRaised: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v100 follows direct A/B inspection of exact-head Full World 3D Topdown #1271 and #1273. v99 removed synthetic channel extremes safely, but broad centre-lowland domains remained too close in aerial value. v100 keeps natural pigments while deepening wet vegetation/earth and modestly lifting dry mineral/heather and sunlit lithology, improving distance readability without changing coverage or geography. map.png, terrain height, hydrology, routes, coastline and collider authority remain untouched.',
		water: 'v100 preserves v99 water coverage and the reduced green-cast clear-shore balance; no bathymetry, shoreline, lake membership or offshore authority changes are introduced.',
		road: 'v100 preserves established compacted-road, rut, dust and moss-edge bases so route geometry and ownership remain unchanged.',
		celestial: 'v100 preserves restrained dawn/noon/sunset/moon calibration and does not alter the day clock or lighting authority.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x102d1d,
		meadow: 0x46783d,
		dryHeather: 0x74513b,
		wetEarth: 0x202a24,
		exposedEarth: 0xa87350,
		graniteShadow: 0x46575e,
		graniteSunlit: 0xb7aa92,
		basaltWet: 0x16262b,
		quartz: 0xd5d0c8,
	}),
	road: Object.freeze({
		compacted: 0x866347,
		rut: 0x1b1917,
		dust: 0xaa8b67,
		stone: 0x68706a,
		mossEdge: 0x2c5435,
	}),
	water: Object.freeze({
		shoreClear: 0x4f7f88,
		lakeClear: 0x28677a,
		riverPool: 0x247182,
		rapid: 0x88adaf,
		deepSea: 0x15485f,
		abyss: 0x0a2c3b,
		plunge: 0x518996,
		splash: 0xe1eeec,
		foam: 0xf2f7f4,
	}),
	celestial: Object.freeze({
		dawn: 0xffae63,
		noon: 0xffefd6,
		sunset: 0xff8750,
		moon: 0xc6d8f6,
	}),
});

export function hexToLinearTriplet(hex) {
	const channel = (shift) => ((hex >> shift) & 0xff) / 255;
	const linear = (value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
	return Object.freeze([linear(channel(16)), linear(channel(8)), linear(channel(0))]);
}

export function relativeLuminanceFromHex(hex) {
	const [r, g, b] = hexToLinearTriplet(hex);
	return r * 0.2126 + g * 0.7152 + b * 0.0722;
}