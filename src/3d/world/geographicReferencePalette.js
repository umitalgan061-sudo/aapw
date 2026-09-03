/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-03-v106-road-river-material-hierarchy',
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
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v106 preserves the v102 lowland material separation calibrated from exact-head Full World 3D Topdown imagery. No terrain domain coverage, map.png interpretation, height, route, coastline or collider authority changes are introduced.',
		water: 'v106 preserves the v104 lake/sea hierarchy while separating calm river pools, aerated rapid reaches and waterfall plunge/splash values. It changes render pigments only; traced river paths, waterfall detection, depth/coverage textures and canonical hydrology authority are unchanged.',
		road: 'v106 preserves v105 road calibration: compacted earth is less orange, wheel-rut shadow is denser, dust is lower-chroma and embedded stone is more neutral. Route topology, ribbon width, terrain sampling and water exclusion are unchanged.',
		celestial: 'v106 preserves restrained dawn/noon/sunset/moon calibration and does not alter the day clock or lighting authority.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x102b1d,
		meadow: 0x517f45,
		dryHeather: 0x856646,
		wetEarth: 0x182721,
		exposedEarth: 0xaa805d,
		graniteShadow: 0x45545a,
		graniteSunlit: 0xb6aa93,
		basaltWet: 0x13242a,
		quartz: 0xd2cec6,
	}),
	road: Object.freeze({
		compacted: 0x745b45,
		rut: 0x211c18,
		dust: 0x9b856d,
		stone: 0x72736d,
		mossEdge: 0x35513a,
	}),
	water: Object.freeze({
		shoreClear: 0x5a8382,
		lakeClear: 0x356b78,
		riverPool: 0x2f6570,
		rapid: 0x7f9da0,
		deepSea: 0x13384c,
		abyss: 0x071f2d,
		plunge: 0x467a89,
		splash: 0xdbe9e6,
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