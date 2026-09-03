/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v98-fullworld-domain-clarity',
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
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v98 follows direct A/B inspection of exact-head Full World 3D Topdown #1257 and #1259. v97 was safe but the measured frame delta remained too small and broad lowlands still read as a soft grey-olive average. v98 therefore increases source-domain clarity one restrained step further: wet vegetation deepens, dry heather warms/darkens, oxidised earth separates from vegetation, and weathered granite shifts cooler/darker. This remains palette-only/render-only; biome coverage, map.png, terrain height, hydrology, routes, coastline and collider authority are unchanged.',
		water: 'v98 preserves the verified v96-v97 marine hierarchy; no water coverage, bathymetry, lake membership, shoreline or offshore authority changes are introduced.',
		road: 'v98 preserves established compacted-road and dust bases, keeping roads distinct from exposed-earth terrain without changing route geometry.',
		celestial: 'v98 preserves restrained noon and moon calibration; aerial depth continues to come from material/ecotone separation rather than stronger global illumination.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x022f13,
		meadow: 0x008f31,
		dryHeather: 0x592b18,
		wetEarth: 0x0c2018,
		exposedEarth: 0xc45b30,
		graniteShadow: 0x37657a,
		graniteSunlit: 0xb7a794,
		basaltWet: 0x07171c,
		quartz: 0xd9d1c7,
	}),
	road: Object.freeze({
		compacted: 0x866347,
		rut: 0x1b1917,
		dust: 0xaa8b67,
		stone: 0x68706a,
		mossEdge: 0x2c5435,
	}),
	water: Object.freeze({
		shoreClear: 0x548a80,
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
