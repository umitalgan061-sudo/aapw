/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v23-natural-lowland-rock-weathering-balance',
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
		terrain: 'deep organic shade, clearer living meadow, subdued umber-heather and warmer mineral-earth ecotones, dark damp lowland pockets, plus separated cool granite / weathered warm rock / near-black wet basalt so canonical land keeps readable geology without the broad beige haze seen in full-world QA',
		water: 'restrained mineral-green littoral water, separated lake and river signatures, blue-black offshore depth with a darker abyss, and aerated neutral-white falls/foam while canonical wet coverage remains unchanged',
		road: 'warm compacted earth, dark damp ruts, pale mineral dust, cooler stone and restrained moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x07180e,
		meadow: 0x1f5530,
		dryHeather: 0x5c4932,
		wetEarth: 0x0d1812,
		exposedEarth: 0x66442b,
		graniteShadow: 0x20272a,
		graniteSunlit: 0x857a70,
		basaltWet: 0x071016,
		quartz: 0xa89f94,
	}),
	road: Object.freeze({
		compacted: 0x876344,
		rut: 0x3b3028,
		dust: 0xae9370,
		stone: 0x535957,
		mossEdge: 0x334c34,
	}),
	water: Object.freeze({
		shoreClear: 0x4f877f,
		lakeClear: 0x376d70,
		riverPool: 0x396a73,
		rapid: 0x568994,
		deepSea: 0x123c54,
		abyss: 0x061725,
		plunge: 0x416874,
		splash: 0xd8e7e5,
		foam: 0xedf5f2,
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
