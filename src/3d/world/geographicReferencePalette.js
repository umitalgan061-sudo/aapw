/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v39-aerial-lowland-separation',
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
		terrain: 'render-verified v39: aerial lowland readability is increased without changing geography: living meadow is cooler/deeper, dry heath and ferric exposures are warmer, damp ground stays low-luminance, and weathered granite/quartz faces retain a brighter mineral response against wet basalt; deterministic world-space albedo/normal/roughness fabric remains the variation source and canonical terrain, shoreline, hydrology and colliders are unchanged',
		water: 'render-verified v39: mineral-green littoral, inland blue-green water, aerated rapids and blue-black offshore depth retain distinct value families while canonical wet coverage, shoreline and hydrology remain unchanged',
		road: 'render-verified v39: compacted earth and mineral dust separate clearly from cool stone shoulders and damp ruts so long road ribbons do not collapse into one flat brown value',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0b2416,
		meadow: 0x205d2d,
		dryHeather: 0x87623a,
		wetEarth: 0x111b16,
		exposedEarth: 0xbf763c,
		graniteShadow: 0x293c48,
		graniteSunlit: 0xaa9175,
		basaltWet: 0x10212b,
		quartz: 0xd4c6ad,
	}),
	road: Object.freeze({
		compacted: 0x765438,
		rut: 0x2d241e,
		dust: 0xbba07a,
		stone: 0x58615f,
		mossEdge: 0x254a2c,
	}),
	water: Object.freeze({
		shoreClear: 0x4d897b,
		lakeClear: 0x326c75,
		riverPool: 0x267181,
		rapid: 0x6da4ad,
		deepSea: 0x072a40,
		abyss: 0x010b15,
		plunge: 0x4b838f,
		splash: 0xe2f0ed,
		foam: 0xf3faf7,
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
