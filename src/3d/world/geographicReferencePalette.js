/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v21-ecotone-lithology-depth',
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
		terrain: 'cool organic shade, a visibly greener living meadow, ochre dry-heather and mineral-earth ecotones, damp lowland depth, and separated cool granite / warm weathered rock values so broad canonical land does not collapse into one khaki field',
		water: 'mineral-green littoral water, distinct lake and river signatures, readable blue-black offshore depth and aerated neutral-white falls/foam while canonical wet coverage remains unchanged',
		road: 'warm compacted earth, dark damp ruts, mineral dust, cooler stone and restrained moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x07170d,
		meadow: 0x1d4728,
		dryHeather: 0x755138,
		wetEarth: 0x0c1917,
		exposedEarth: 0x70452d,
		graniteShadow: 0x18252c,
		graniteSunlit: 0x88786b,
		basaltWet: 0x071116,
		quartz: 0xaaa39a,
	}),
	road: Object.freeze({
		compacted: 0x8d6847,
		rut: 0x48372d,
		dust: 0xb49470,
		stone: 0x585851,
		mossEdge: 0x3d5138,
	}),
	water: Object.freeze({
		shoreClear: 0x5a8b84,
		lakeClear: 0x467477,
		riverPool: 0x486d73,
		rapid: 0x5b8791,
		deepSea: 0x174760,
		abyss: 0x071e30,
		plunge: 0x4d707a,
		splash: 0xd8e8e6,
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
