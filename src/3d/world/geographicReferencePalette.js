/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-01-v74-aerial-mineral-vegetation-separation',
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
		terrain: 'v74 keeps canonical biome placement and terrain geometry unchanged while reducing over-saturated aerial green, lifting mineral/rock tonal separation and keeping damp shadow materially darker than exposed soil. Existing deterministic world-space biome, erosion, normal and roughness variation remains authoritative for within-surface breakup.',
		water: 'v74 preserves the v73 hydrology material separation and v72 deepSea/abyss handoff unchanged; canonical bathymetry, wet coverage, shoreline, lake membership, water geometry and colliders remain unchanged.',
		road: 'v74 preserves darker damp ruts and subdued mineral dust so canonical roads stay materially worn rather than painted ribbons',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x07170e,
		meadow: 0x214d2c,
		dryHeather: 0x53452f,
		wetEarth: 0x0a1511,
		exposedEarth: 0x895f45,
		graniteShadow: 0x30373a,
		graniteSunlit: 0x686159,
		basaltWet: 0x0a171c,
		quartz: 0x777168,
	}),
	road: Object.freeze({
		compacted: 0x684b38,
		rut: 0x28231f,
		dust: 0xa98f6f,
		stone: 0x5c6562,
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
