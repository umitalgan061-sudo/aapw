/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v113-full-world-land-water-separation',
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
	fullWorldGreyBeigeCompressionReduced: true,
	openSeaAerialBlackCrushReduced: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v113 follows direct inspection of exact-head Full World #1315. Broad lowlands still merged into a grey-beige field, so damp organic ground remains cool while meadow, dry heather, exposed mineral earth and lithology are separated by restrained value and hue rather than saturation. Canonical height, map.png, hydrology, coastline, routes and collider authority remain unchanged.',
		water: 'v113 follows direct #1315 inspection and lifts boundary-connected open-sea midtones slightly to avoid aerial black crush while preserving lake, river, shelf and abyss hierarchy. Canonical depth, coverage, offshore connectivity and shoreline ownership are unchanged.',
		road: 'v113 keeps compacted medieval earth inside the surrounding mineral gamut while preserving darker ruts and embedded-stone separation. Route topology, width, terrain sampling and water exclusion are unchanged.',
		celestial: 'v113 preserves restrained dawn/noon/sunset/moon calibration and does not alter the day clock or lighting authority.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x173328,
		meadow: 0x5b824c,
		dryHeather: 0x927654,
		wetEarth: 0x26342e,
		exposedEarth: 0xa48062,
		graniteShadow: 0x48565e,
		graniteSunlit: 0xb7b09f,
		basaltWet: 0x1d2e34,
		quartz: 0xd4d2cc,
	}),
	road: Object.freeze({
		compacted: 0x735d4b,
		rut: 0x29241f,
		dust: 0x968570,
		stone: 0x797a75,
		mossEdge: 0x38563f,
	}),
	water: Object.freeze({
		shoreClear: 0x6d958f,
		lakeClear: 0x3a6d7c,
		riverPool: 0x2f606a,
		rapid: 0x90acad,
		deepSea: 0x204b61,
		abyss: 0x0b2738,
		plunge: 0x447789,
		splash: 0xe4efec,
		foam: 0xf4f9f6,
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
