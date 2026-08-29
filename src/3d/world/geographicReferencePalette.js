/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-29-v19-lowland-ecology-rock-weathering-separation',
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
		terrain: 'deeper cool organic shadows, stronger living-meadow versus dry-heather/mineral-soil separation, saturated damp horizons, and wider weathered-rock shadow/sun/mineral contrast so full-world lowlands and massifs retain ecological and lithologic depth without changing canonical geography',
		water: 'cool mineral-green littoral water with restrained saturation, distinct lake and river mineral signatures, blue-black offshore depth that remains readable instead of clipping to black, and aerated neutral-white falls/foam',
		road: 'warm compacted earth, dark damp ruts, mineral dust, stone and moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x06130c,
		meadow: 0x163821,
		dryHeather: 0x78513a,
		wetEarth: 0x0a1515,
		exposedEarth: 0x68432e,
		graniteShadow: 0x101a21,
		graniteSunlit: 0x827366,
		basaltWet: 0x040b10,
		quartz: 0xa79f96,
	}),
	road: Object.freeze({
		compacted: 0x8b6849,
		rut: 0x4d3b2e,
		dust: 0xb0926d,
		stone: 0x5c574d,
		mossEdge: 0x40523a,
	}),
	water: Object.freeze({
		shoreClear: 0x527f7b,
		lakeClear: 0x456d6d,
		riverPool: 0x48666a,
		rapid: 0x567f8a,
		deepSea: 0x123b52,
		abyss: 0x0b2838,
		plunge: 0x4a6973,
		splash: 0xd5e5e4,
		foam: 0xeaf3f1,
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
