/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v93-directional-domain-readability',
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
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v93 follows direct A/B inspection of exact-head Full World 3D Topdown #1247 and v19 #1249. The new deterministic directional lowland domains are structurally safe but were visually too subtle at full-world distance. v93 therefore increases wet-meadow chlorophyll readability, darkens warm dry-heather, strengthens oxidised exposed-earth separation, and nudges weathered granite cooler so the existing v19 wet/dry/lithic domains survive aerial averaging. This remains render-only: biome coverage, terrain height, map, hydrology, route, coastline and collider authority are unchanged.',
		water: 'v93 preserves the verified marine correction: deep sea and abyss remain readable without near-black crushing and coastal water stays cooler/desaturated. Coverage, bathymetry, lake membership, shoreline and offshore authority are unchanged.',
		road: 'v93 preserves established compacted-road and dust bases, keeping roads distinct from exposed-earth terrain without changing route geometry.',
		celestial: 'v93 preserves restrained noon and moon calibration; aerial depth is produced by material/ecotone separation rather than stronger global illumination.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x063b1d,
		meadow: 0x0b8034,
		dryHeather: 0x422318,
		wetEarth: 0x10231b,
		exposedEarth: 0xa35231,
		graniteShadow: 0x304953,
		graniteSunlit: 0xc2b4a1,
		basaltWet: 0x0b1b20,
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
		shoreClear: 0x4d8278,
		lakeClear: 0x286373,
		riverPool: 0x247182,
		rapid: 0x88adaf,
		deepSea: 0x174b62,
		abyss: 0x0b3040,
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
