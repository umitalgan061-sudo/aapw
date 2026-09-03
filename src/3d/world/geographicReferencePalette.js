/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v111-lowland-material-recovery',
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
	lowlandWetDryLumaGapRaised: true,
	vegetationMineralHueGapRaised: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v111 follows direct inspection of exact-head Full World #1311. The v110 neutralisation removed some black/orange bias but broad lowlands remained too grey-olive at aerial distance. Damp organic ground is therefore held cool/dark, meadow is separated with restrained chlorophyll, dry heather and exposed mineral soil recover a modest warm-value gap, and granite/basalt retain neutral lithologic contrast. Canonical height, map.png, hydrology, coastline, routes and collider authority remain unchanged.',
		water: 'v111 preserves the v109 boundary-connected marine hierarchy and all canonical depth/coverage/offshore masks. No hydrology, normal field or shoreline authority changes are introduced.',
		road: 'v111 keeps roads inside the surrounding mineral gamut while increasing the compacted/rut/stone value hierarchy enough to survive aerial distance. Route topology, width, terrain sampling and water exclusion are unchanged.',
		celestial: 'v111 preserves restrained dawn/noon/sunset/moon calibration and does not alter the day clock or lighting authority.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x10291f,
		meadow: 0x4f7945,
		dryHeather: 0x866b4c,
		wetEarth: 0x1d2a26,
		exposedEarth: 0x9d7859,
		graniteShadow: 0x424e55,
		graniteSunlit: 0xb1aa98,
		basaltWet: 0x17272c,
		quartz: 0xd0cdc5,
	}),
	road: Object.freeze({
		compacted: 0x715a47,
		rut: 0x241f1c,
		dust: 0x93816b,
		stone: 0x747570,
		mossEdge: 0x34513b,
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
