/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-31-v63-aerial-ecotone-weathering',
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
		terrain: 'v63 follows direct inspection of exact-head full-world #650: canonical geography remains intact, but broad central/western lowlands still collapse toward one grey-olive aerial value. Meadow is lifted toward a restrained humid green, dry heather is warmed and separated, ferric earth gains a small mineral lift, and granite/quartz receive more sun/shadow separation so erosion and ecotone fabric survive the high camera without altering terrain height, shoreline, hydrology, colliders or inventing geography.',
		water: 'v63 preserves the v62 depth hierarchy: clear shallows/lakes remain distinct from boundary-connected deep sea while canonical wet coverage and shoreline ownership remain unchanged.',
		road: 'v63 preserves established compacted-road and dust bases while slightly separating damp ruts, mineral stone and moss edge, improving worn-road material breakup without changing route geometry.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x062417,
		meadow: 0x277949,
		dryHeather: 0x73583d,
		wetEarth: 0x0b1813,
		exposedEarth: 0xa76643,
		graniteShadow: 0x18232a,
		graniteSunlit: 0xa89a88,
		basaltWet: 0x020b0f,
		quartz: 0xb4a794,
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
		deepSea: 0x0a3049,
		abyss: 0x031520,
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
