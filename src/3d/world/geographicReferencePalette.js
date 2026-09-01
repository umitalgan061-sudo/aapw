/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-01-v76-aerial-lithology-breakup',
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
		terrain: 'v76 increases aerial lithology separation without changing biome placement or geometry: meadow gains a restrained natural-green lift, dry/exposed earth diverge by warmth and value, and granite/quartz widen their neutral range so existing deterministic world-space erosion, normal and roughness breakup reads from full-world altitude instead of collapsing into one grey-beige field.',
		water: 'v76 preserves the v73 hydrology material separation and v72 deepSea/abyss handoff unchanged; canonical bathymetry, wet coverage, shoreline, lake membership, water geometry and colliders remain unchanged.',
		road: 'v76 increases compacted-earth versus rut/stone separation slightly while preserving canonical routes and existing world-space wear so roads read as worn ground rather than painted ribbons.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0d2115,
		meadow: 0x2f633d,
		dryHeather: 0x6b553b,
		wetEarth: 0x101a15,
		exposedEarth: 0xa0704d,
		graniteShadow: 0x303a40,
		graniteSunlit: 0x80786e,
		basaltWet: 0x101d22,
		quartz: 0x948c81,
	}),
	road: Object.freeze({
		compacted: 0x70503b,
		rut: 0x26211e,
		dust: 0xad9270,
		stone: 0x606967,
		mossEdge: 0x294a31,
	}),
	water: Object.freeze({
		shoreClear: 0x457b6b,
		lakeClear: 0x285b6b,
		riverPool: 0x236b7c,
		rapid: 0x82a7aa,
		deepSea: 0x255d6d,
		abyss: 0x255c6c,
		plunge: 0x4d818b,
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
