/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-29-v14-natural-lowland-rock-separation',
	renderOnly: true,
	deterministic: true,
	heightAuthorityUnchanged: true,
	hydrologyAuthorityUnchanged: true,
	routeAuthorityUnchanged: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'cooler deeper moss and saturated wet-soil shadows, clearer living-meadow versus dry-heather ecology, darker weathered exposed earth, stronger cool-shadow versus neutral-sunlit granite separation, darker wet basalt and restrained quartz for readable natural weathering without changing canonical geography',
		water: 'restrained mineral-green shallows, readable blue-black depth, aerated neutral-white falls',
		road: 'warm compacted earth, dark damp ruts, mineral dust, stone and moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x102217,
		meadow: 0x315a34,
		dryHeather: 0x745039,
		wetEarth: 0x1a2624,
		exposedEarth: 0x5b3f34,
		graniteShadow: 0x202b31,
		graniteSunlit: 0x6f6258,
		basaltWet: 0x0d171c,
		quartz: 0x95918b,
	}),
	road: Object.freeze({
		compacted: 0x8b6849,
		rut: 0x4d3b2e,
		dust: 0xb0926d,
		stone: 0x5c574d,
		mossEdge: 0x40523a,
	}),
	water: Object.freeze({
		shoreClear: 0x668f8b,
		lakeClear: 0x537b78,
		riverPool: 0x566f6b,
		rapid: 0x527987,
		deepSea: 0x10354a,
		abyss: 0x0a2230,
		plunge: 0x506f76,
		splash: 0xd8e7e5,
		foam: 0xecf5f3,
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
