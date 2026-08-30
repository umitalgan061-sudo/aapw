/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v46-lowland-material-depth',
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
		terrain: 'render-verified v46 after full-world #549/#550 inspection: broad pale mineral dominance is reduced again while living meadow, damp organic ground and muted olive-brown heath carry more visual depth; ferric exposure stays bounded and weathered granite/quartz remain distinct from wet basalt without washing lowlands beige. Deterministic world-space albedo/normal/roughness fabric remains the variation source; canonical terrain, shoreline, hydrology and colliders are unchanged',
		water: 'v46 retains the restrained shallow/inland/offshore optical hierarchy from v44-v45; canonical wet coverage, shoreline and hydrology are unchanged',
		road: 'compacted earth, wet ruts, pale mineral dust and cool stone shoulders remain materially distinct without a uniform painted-ribbon response',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0c2217,
		meadow: 0x1f4529,
		dryHeather: 0x635637,
		wetEarth: 0x0f1815,
		exposedEarth: 0x95623f,
		graniteShadow: 0x2d3e46,
		graniteSunlit: 0x84776a,
		basaltWet: 0x102129,
		quartz: 0xaaa292,
	}),
	road: Object.freeze({
		compacted: 0x73513a,
		rut: 0x2e251e,
		dust: 0xb79d79,
		stone: 0x5f6865,
		mossEdge: 0x284b31,
	}),
	water: Object.freeze({
		shoreClear: 0x4a8278,
		lakeClear: 0x2b6775,
		riverPool: 0x246b7b,
		rapid: 0x82aaaf,
		deepSea: 0x07263a,
		abyss: 0x010911,
		plunge: 0x4e8490,
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
