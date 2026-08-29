/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v22-lowland-lithology-hydrology-separation',
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
		terrain: 'deep organic shade, distinctly green living meadow, dry umber-heather and warm mineral-earth ecotones, dark damp lowland pockets, plus separated cool granite / weathered warm rock / near-black wet basalt so broad canonical land does not collapse into one khaki field',
		water: 'mineral-green littoral water, separated lake and river signatures, blue-black offshore depth with a darker abyss, and aerated neutral-white falls/foam while canonical wet coverage remains unchanged',
		road: 'warm compacted earth, dark damp ruts, pale mineral dust, cooler stone and restrained moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x06140b,
		meadow: 0x174c27,
		dryHeather: 0x70452f,
		wetEarth: 0x091613,
		exposedEarth: 0x7b482b,
		graniteShadow: 0x16242d,
		graniteSunlit: 0x918073,
		basaltWet: 0x050d12,
		quartz: 0xb3aba0,
	}),
	road: Object.freeze({
		compacted: 0x926947,
		rut: 0x433329,
		dust: 0xb99b76,
		stone: 0x555a58,
		mossEdge: 0x385338,
	}),
	water: Object.freeze({
		shoreClear: 0x579188,
		lakeClear: 0x3e7779,
		riverPool: 0x3f6d75,
		rapid: 0x5b8d99,
		deepSea: 0x15445e,
		abyss: 0x061929,
		plunge: 0x456d78,
		splash: 0xdcebe8,
		foam: 0xf0f7f4,
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
