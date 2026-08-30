/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-31-v49-lowland-material-depth',
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
		terrain: 'v49 deepens lowland material value hierarchy without moving any canonical boundary: damp organic ground and moss shadow are darker, live meadow remains chromatically distinct, weathered heath/mineral exposures separate from pale rock, and granite/quartz are restrained so aerial lowlands retain ecological breakup instead of flattening toward beige. World-space deterministic surface fabric remains the variation source; terrain, shoreline, hydrology and colliders are unchanged',
		water: 'v49 preserves restrained cyan and existing inland/offshore optical separation; canonical wet coverage, shoreline and hydrology are unchanged',
		road: 'compacted earth, wet ruts, pale mineral dust and cool stone shoulders remain materially distinct without a uniform painted-ribbon response',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x071a11,
		meadow: 0x164b27,
		dryHeather: 0x73552f,
		wetEarth: 0x08120f,
		exposedEarth: 0x9b6038,
		graniteShadow: 0x26373d,
		graniteSunlit: 0x76685d,
		basaltWet: 0x091922,
		quartz: 0x998d7d,
	}),
	road: Object.freeze({
		compacted: 0x73513a,
		rut: 0x2e251e,
		dust: 0xb79d79,
		stone: 0x5f6865,
		mossEdge: 0x284b31,
	}),
	water: Object.freeze({
		shoreClear: 0x467a72,
		lakeClear: 0x275f70,
		riverPool: 0x206476,
		rapid: 0x7fa6ab,
		deepSea: 0x062338,
		abyss: 0x010811,
		plunge: 0x4a7f8b,
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
