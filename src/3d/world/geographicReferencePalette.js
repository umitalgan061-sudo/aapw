/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-31-v59-aerial-rock-ecotone-recovery',
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
		terrain: 'v59 retains the v58 aerial ecotone recovery and widens only the restrained mineral value range after exact-head browser QA measured exposed-rock colour separation below the geological visibility floor. Damp moss/meadow/heath/earth remain ecologically distinct; granite shadow, sunlit granite, wet basalt and quartz now preserve weathering and strata readability without changing rock authority or terrain geometry.',
		water: 'v59 keeps the v58 deep-sea and abyss lift so depth hierarchy survives the high full-world camera while offshore water remains darker than rivers, lakes and clear shallows. Canonical wet coverage and shoreline ownership remain unchanged.',
		road: 'v59 preserves established cart-road and footpath base colours required by the live road mesh contract; rut, stone and moss-edge separation provide wet/dry and wear variation without changing route geometry.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x052011,
		meadow: 0x176536,
		dryHeather: 0x58472e,
		wetEarth: 0x0c1814,
		exposedEarth: 0x9f5e3d,
		graniteShadow: 0x252d31,
		graniteSunlit: 0x7a7267,
		basaltWet: 0x06141b,
		quartz: 0x8a8175,
	}),
	road: Object.freeze({
		compacted: 0x8b6849,
		rut: 0x211d1a,
		dust: 0xb0926d,
		stone: 0x626b67,
		mossEdge: 0x294d32,
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
