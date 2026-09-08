/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-31-v57-ground-readability',
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
		terrain: 'v57 follows direct inspection of the exact-head 2026-08-31 full-world shipped createScene artifact: canonical relief reads correctly, but broad lowlands still collapse into one olive-grey value at aerial scale. Meadow and moss are lifted into distinct natural green families, dry heath is separated into a warmer mineral-brown band, wet soil gains readable but still subdued value, and exposed strata/sunlit granite is lifted into a pale neutral mineral family while shadow granite stays mid-dark; this preserves measured cliff geology separation without changing terrain height, shoreline, hydrology or colliders',
		water: 'v57 preserves the v54 shore/inland/deep-water hierarchy and restrained cyan; canonical wet coverage, shoreline and hydrology are unchanged',
		road: 'v57 preserves darker damp ruts and subdued mineral dust so canonical roads stay materially worn rather than painted ribbons',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x102a1b,
		meadow: 0x315b35,
		dryHeather: 0x65563a,
		wetEarth: 0x20261d,
		exposedEarth: 0x87563b,
		graniteShadow: 0x343c3e,
		graniteSunlit: 0x9c9588,
		basaltWet: 0x0d171a,
		quartz: 0x81796f,
	}),
	road: Object.freeze({
		compacted: 0x684b38,
		rut: 0x28231f,
		dust: 0xa98f6f,
		stone: 0x5c6562,
		mossEdge: 0x294a31,
	}),
	water: Object.freeze({
		shoreClear: 0x487c6f,
		lakeClear: 0x2a6170,
		riverPool: 0x246776,
		rapid: 0x82a7aa,
		deepSea: 0x08263a,
		abyss: 0x020a12,
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
