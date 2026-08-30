/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v26-lowland-ecotone-readability-after-render',
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
		terrain: 'render-verified v26: clearer living green versus cool umber heath and warm ferric mineral earth, deeper damp organic pockets, and wider cool-granite / weathered-sunlit-rock separation so world-space fabric remains visible at full-world scale without moving canonical terrain or shoreline',
		water: 'restrained mineral-green littoral water, separated lake and river signatures, blue-black offshore depth with a darker abyss, and aerated neutral-white falls/foam while canonical wet coverage remains unchanged',
		road: 'warm compacted earth, dark damp ruts, pale mineral dust, cooler stone and restrained moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x05190f,
		meadow: 0x1b7138,
		dryHeather: 0x443625,
		wetEarth: 0x07150f,
		exposedEarth: 0x714526,
		graniteShadow: 0x162126,
		graniteSunlit: 0x877b71,
		basaltWet: 0x040c12,
		quartz: 0xaaa196,
	}),
	road: Object.freeze({
		compacted: 0x805f43,
		rut: 0x392e27,
		dust: 0xa68c6a,
		stone: 0x505654,
		mossEdge: 0x304b33,
	}),
	water: Object.freeze({
		shoreClear: 0x4b827a,
		lakeClear: 0x35696c,
		riverPool: 0x376873,
		rapid: 0x52848f,
		deepSea: 0x113a51,
		abyss: 0x051622,
		plunge: 0x3f6571,
		splash: 0xd6e5e3,
		foam: 0xebf4f1,
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
