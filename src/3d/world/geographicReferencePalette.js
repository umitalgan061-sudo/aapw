/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v37-aerial-ecotone-readability',
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
		terrain: 'render-verified v37: aerial-scale ecotone readability is increased without saturating the map: living meadow remains cool green, heath/mineral soils separate into warmer families, damp ground stays dark, granite keeps cool shadow plus restrained weathered faces, and wet basalt remains blue-black; existing deterministic world-space albedo/normal/roughness fabric remains the variation source and canonical terrain, shoreline, hydrology and colliders are unchanged',
		water: 'render-verified v37: mineral-green littoral stays visibly distinct from cold inland water and blue-black offshore depth while canonical wet coverage, shoreline and hydrology remain unchanged',
		road: 'render-verified v37: compacted earth, damp ruts, mineral dust and cooler stone shoulders retain distinct values so road material does not collapse into a uniform brown ribbon',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x10291a,
		meadow: 0x2b6535,
		dryHeather: 0x7b5e3c,
		wetEarth: 0x17221b,
		exposedEarth: 0xae7544,
		graniteShadow: 0x31424b,
		graniteSunlit: 0x9d8872,
		basaltWet: 0x162630,
		quartz: 0xc8bca5,
	}),
	road: Object.freeze({
		compacted: 0x7b5a3e,
		rut: 0x322821,
		dust: 0xb09672,
		stone: 0x565d59,
		mossEdge: 0x2b4d32,
	}),
	water: Object.freeze({
		shoreClear: 0x4f8779,
		lakeClear: 0x346a72,
		riverPool: 0x286e7f,
		rapid: 0x6a9fa8,
		deepSea: 0x082b41,
		abyss: 0x010c16,
		plunge: 0x487f8c,
		splash: 0xdfeeeB,
		foam: 0xf2f9f6,
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
