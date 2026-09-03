/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v99-natural-pigment-distance-readability',
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
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v99 follows direct inspection of exact-head Full World 3D Topdown #1271. v98 separated source domains but used channel-extreme greens, orange earth and cyan rock that collapse into synthetic pigment bands at aerial distance. v99 keeps luminance and material-domain separation while moving vegetation, earth and lithology toward natural mineral/chlorophyll pigments. This is render-only; biome coverage, map.png, terrain height, hydrology, routes, coastline and collider authority are unchanged.',
		water: 'v99 preserves verified water coverage and depth hierarchy while shifting only the clear-shore tint slightly toward mineral blue-cyan to reduce the green halo seen around lowland coasts in #1271.',
		road: 'v99 keeps established compacted-road and dust bases so route geometry and road ownership remain unchanged.',
		celestial: 'v99 preserves restrained noon and moon calibration; no day-clock or lighting authority changes are introduced.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x183522,
		meadow: 0x3f7138,
		dryHeather: 0x6b4936,
		wetEarth: 0x293229,
		exposedEarth: 0x9f6848,
		graniteShadow: 0x4d5d61,
		graniteSunlit: 0xb1a590,
		basaltWet: 0x1b2b30,
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