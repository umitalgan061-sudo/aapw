/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v112-aerial-material-value-hierarchy',
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
	aerialWaterNormalReadabilitySupported: true,
	openSeaMidtoneHeadroomRaised: true,
	terrainWaterValueCollisionReduced: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v112 increases the distant value gap between chlorophyll-rich meadow, damp organic soil, dry heather/mineral earth and exposed lithology without increasing saturation. The change is render-only and leaves canonical height, map.png, hydrology, coastline, routes and collider authority untouched.',
		water: 'v112 raises open-sea midtone headroom and separates lake/river/coastal values so the existing world-space current, normal and roughness breakup survives aerial compression more clearly. Canonical depth, coverage, offshore connectivity and shoreline ownership are unchanged.',
		road: 'v112 keeps compacted medieval earth inside the surrounding mineral gamut while preserving darker ruts and embedded-stone separation. Route topology, width, terrain sampling and water exclusion are unchanged.',
		celestial: 'v112 preserves restrained dawn/noon/sunset/moon calibration and does not alter the day clock or lighting authority.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x173126,
		meadow: 0x587f49,
		dryHeather: 0x8e7252,
		wetEarth: 0x24302a,
		exposedEarth: 0xa07d60,
		graniteShadow: 0x46535b,
		graniteSunlit: 0xb5ae9d,
		basaltWet: 0x1b2b31,
		quartz: 0xd2d0ca,
	}),
	road: Object.freeze({
		compacted: 0x725c49,
		rut: 0x28231f,
		dust: 0x95836f,
		stone: 0x777873,
		mossEdge: 0x36533d,
	}),
	water: Object.freeze({
		shoreClear: 0x6a928d,
		lakeClear: 0x386b7a,
		riverPool: 0x2d5d67,
		rapid: 0x8da9aa,
		deepSea: 0x1b455b,
		abyss: 0x082131,
		plunge: 0x417486,
		splash: 0xe2eeea,
		foam: 0xf3f8f5,
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
