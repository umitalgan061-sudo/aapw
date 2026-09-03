/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v110-natural-relief-separation',
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
	lowlandMaterialReliefRaised: true,
	distantLowlandContrastRaised: true,
	naturalWaterDepthHierarchyRaised: true,
	lakeRiverOpticalSeparationRaised: true,
	openSeaSlateDepthRaised: true,
	aerialWaterSeparationRaised: true,
	roadMaterialHierarchyRaised: true,
	roadDustOrangeCastReduced: true,
	roadStoneRutSeparationRaised: true,
	riverReachValueSeparationRaised: true,
	waterfallAerationContrastRaised: true,
	plungePoolDepthRaised: true,
	fullWorldTerrainMaterialHierarchyRaised: true,
	meadowDrylandValueSeparationRaised: true,
	lithologyShadowSeparationRaised: true,
	shallowSedimentOpticalSeparationRaised: true,
	lakeMarineHueDecorrelationRaised: true,
	riverPoolRapidEnergySeparationRaised: true,
	waterfallPlungeFoamValueRangeRaised: true,
	aerialOpenWaterMidtoneRaised: true,
	openWaterFabricVisibilityRaised: true,
	weatheredStoneNeutralityRaised: true,
	wetGroundBlackCrushReduced: true,
	dryGroundOrangeCastReduced: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v110 keeps canonical geography untouched and separates damp organic ground, dry mineral soil and exposed lithology with a narrower natural-earth gamut. Wet earth is lifted out of near-black crush, dry ground loses orange saturation, and granite/basalt preserve weathered neutral separation at aerial distance.',
		water: 'v110 preserves the v109 boundary-connected marine hierarchy and all canonical depth/coverage/offshore masks. No hydrology, normal field or shoreline authority changes are introduced.',
		road: 'v110 preserves route topology and ribbon geometry while keeping compacted earth, ruts, dust and embedded stone in the same restrained mineral family as surrounding terrain.',
		celestial: 'v110 preserves restrained dawn/noon/sunset/moon calibration and does not alter the day clock or lighting authority.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x132a20,
		meadow: 0x4c7444,
		dryHeather: 0x82694f,
		wetEarth: 0x202b27,
		exposedEarth: 0x98765d,
		graniteShadow: 0x465158,
		graniteSunlit: 0xada796,
		basaltWet: 0x1a292d,
		quartz: 0xcecbc3,
	}),
	road: Object.freeze({
		compacted: 0x6e5a49,
		rut: 0x27211d,
		dust: 0x90806d,
		stone: 0x70716d,
		mossEdge: 0x36503d,
	}),
	water: Object.freeze({
		shoreClear: 0x628c87,
		lakeClear: 0x326474,
		riverPool: 0x28565f,
		rapid: 0x88a4a5,
		deepSea: 0x173d52,
		abyss: 0x061b29,
		plunge: 0x3b6d7d,
		splash: 0xdfece8,
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
