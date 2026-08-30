/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v41-weathered-aerial-contrast',
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
		terrain: 'render-verified v41: broad lowland values are separated more strongly at aerial scale while staying weathered and desaturated: living meadow is deeper, dry heath and ferric earth are warmer, damp ground remains dark, and exposed granite/quartz stay distinct from wet basalt; deterministic world-space albedo/normal/roughness fabric remains the variation source and canonical terrain, shoreline, hydrology and colliders are unchanged',
		water: 'render-verified v41: shallow mineral-green water, inland pools, aerated rapids and offshore depth gain clearer luminance hierarchy while canonical wet coverage, shoreline and hydrology remain unchanged',
		road: 'render-verified v41: compacted earth, wet ruts, pale mineral dust and cool stone shoulders remain visibly distinct without turning roads into a uniform painted ribbon',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0f2719,
		meadow: 0x2b5b35,
		dryHeather: 0x7d5d3e,
		wetEarth: 0x171e19,
		exposedEarth: 0xa96d43,
		graniteShadow: 0x35444c,
		graniteSunlit: 0xa38c74,
		basaltWet: 0x17262d,
		quartz: 0xc8bba6,
	}),
	road: Object.freeze({
		compacted: 0x72513a,
		rut: 0x322820,
		dust: 0xb29a78,
		stone: 0x626864,
		mossEdge: 0x2b4d31,
	}),
	water: Object.freeze({
		shoreClear: 0x4f8378,
		lakeClear: 0x326875,
		riverPool: 0x296d7c,
		rapid: 0x79a9ae,
		deepSea: 0x09283b,
		abyss: 0x020a12,
		plunge: 0x50838d,
		splash: 0xdcebe8,
		foam: 0xeff5f2,
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
