/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-31-v66-ocean-depth-readability',
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
	legacyRoadBaseContractPreserved: true,
	exposedRockSeparationRaised: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v66 preserves the v65 lowland chroma balance and all terrain-authority contracts. No terrain height, shoreline, collider, biome ownership or map-derived geography is changed.',
		water: 'v66 follows exact-head full-world #574 visual inspection: the open sea read nearly black at aerial scale, collapsing the shallow/deep/abyss hierarchy. DeepSea and abyss values are lifted slightly while keeping abyss darker than deep sea and leaving canonical wet coverage, shoreline and bathymetry untouched.',
		road: 'v66 preserves established compacted-road and dust bases plus damp-rut/stone/moss-edge separation; route geometry remains unchanged.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x062417,
		meadow: 0x477a4d,
		dryHeather: 0x826b51,
		wetEarth: 0x0b1813,
		exposedEarth: 0xb2734e,
		graniteShadow: 0x151f25,
		graniteSunlit: 0xb3a491,
		basaltWet: 0x020b0f,
		quartz: 0xbeb09d,
	}),
	road: Object.freeze({
		compacted: 0x8b6849,
		rut: 0x1c1a18,
		dust: 0xb0926d,
		stone: 0x69716b,
		mossEdge: 0x2f5838,
	}),
	water: Object.freeze({
		shoreClear: 0x528a7b,
		lakeClear: 0x2c6d7d,
		riverPool: 0x287585,
		rapid: 0x8aafb0,
		deepSea: 0x0d3851,
		abyss: 0x071c27,
		plunge: 0x568d98,
		splash: 0xe2efed,
		foam: 0xf3f8f5,
	}),
	celestial: Object.freeze({
		dawn: 0xffb366,
		noon: 0xfff2d8,
		sunset: 0xff8c52,
		moon: 0xc8dcff,
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