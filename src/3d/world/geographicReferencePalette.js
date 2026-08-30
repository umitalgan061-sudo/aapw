/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v43-aerial-ecotone-separation',
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
		terrain: 'render-verified v43 after exact-head full-world inspection: living meadow is darker/cooler, dry heath and ferric exposure are warmer and more mineral, damp organic ground remains nearly neutral-dark, and granite/quartz retain separate weathered values so broad lowlands no longer collapse toward one beige family; deterministic world-space albedo/normal/roughness fabric remains the variation source and canonical terrain, shoreline, hydrology and colliders are unchanged',
		water: 'render-verified v43: shallow mineral-green shore water, inland pools, aerated rapids and offshore depth preserve a distinct optical hierarchy without changing canonical wet coverage, shoreline or hydrology',
		road: 'render-verified v43: compacted earth, wet ruts, pale mineral dust and cool stone shoulders remain materially distinct without a uniform painted-ribbon response',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0d2418,
		meadow: 0x285431,
		dryHeather: 0x89603c,
		wetEarth: 0x131b18,
		exposedEarth: 0xb47445,
		graniteShadow: 0x30424c,
		graniteSunlit: 0xad9277,
		basaltWet: 0x12242d,
		quartz: 0xcebea8,
	}),
	road: Object.freeze({
		compacted: 0x73513a,
		rut: 0x2e251e,
		dust: 0xb79d79,
		stone: 0x5f6865,
		mossEdge: 0x284b31,
	}),
	water: Object.freeze({
		shoreClear: 0x4d887d,
		lakeClear: 0x2d6b79,
		riverPool: 0x246f82,
		rapid: 0x82b0b4,
		deepSea: 0x07273d,
		abyss: 0x010911,
		plunge: 0x508995,
		splash: 0xdeedeb,
		foam: 0xf1f7f4,
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
