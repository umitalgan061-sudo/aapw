/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v40-natural-material-value-separation',
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
		terrain: 'render-verified v40: lowland greens are slightly less saturated and exposed earth/stone retain warmer weathered values, improving aerial material separation without painting biome blocks; deterministic world-space albedo/normal/roughness fabric remains the variation source and canonical terrain, shoreline, hydrology and colliders are unchanged',
		water: 'render-verified v40: littoral water, inland pools, aerated rapids and offshore depth use closer natural hues but stronger luminance/depth separation, while canonical wet coverage, shoreline and hydrology remain unchanged',
		road: 'render-verified v40: compacted earth, wet ruts, pale mineral dust and cool stone shoulders retain distinct weathered values so road ribbons read as material assemblies rather than a uniform brown strip',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0d2518,
		meadow: 0x24552f,
		dryHeather: 0x80613f,
		wetEarth: 0x151d18,
		exposedEarth: 0xb47443,
		graniteShadow: 0x30414a,
		graniteSunlit: 0xa99176,
		basaltWet: 0x14252d,
		quartz: 0xcfc2aa,
	}),
	road: Object.freeze({
		compacted: 0x735238,
		rut: 0x302720,
		dust: 0xb59a74,
		stone: 0x606764,
		mossEdge: 0x294b30,
	}),
	water: Object.freeze({
		shoreClear: 0x4b8176,
		lakeClear: 0x316872,
		riverPool: 0x286d7b,
		rapid: 0x76a8ad,
		deepSea: 0x08293d,
		abyss: 0x020c15,
		plunge: 0x4e828b,
		splash: 0xddece9,
		foam: 0xf0f6f3,
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
