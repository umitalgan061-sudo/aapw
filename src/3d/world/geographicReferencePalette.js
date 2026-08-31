/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-31-v57-ecotone-depth-separation',
	renderOnly: true,
	deterministic: true,
	heightAuthorityUnchanged: true,
	hydrologyAuthorityUnchanged: true,
	routeAuthorityUnchanged: true,
	ecotoneContrastRaised: true,
	wetDryValueSeparationRaised: true,
	rockValueCompressionReduced: true,
	waterDepthHierarchyRaised: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v57 keeps v56 deterministic world-space fabric but increases ecological value separation: damp moss stays near-black green, meadow moves into a clearer chlorophyll mid-green, dry heath becomes warmer/browner, ferric earth remains mineral-red, and granite regains a broader lit/shadow range. This targets the aerial olive-grey collapse without changing terrain height, shoreline, hydrology, collider or biome authority.',
		water: 'v57 slightly separates clear shallows, inland water, river pools and deep sea so depth reads from altitude while canonical wet coverage, shoreline and hydrology remain unchanged.',
		road: 'v57 keeps compacted earth warm, darkens wet rut material and slightly lifts dry dust/stone contrast so wear reads as material history rather than a uniform painted ribbon.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x04170d,
		meadow: 0x12572b,
		dryHeather: 0x51422d,
		wetEarth: 0x0b1713,
		exposedEarth: 0x9b5b3c,
		graniteShadow: 0x30383b,
		graniteSunlit: 0x676159,
		basaltWet: 0x081820,
		quartz: 0x746e64,
	}),
	road: Object.freeze({
		compacted: 0x6c4c38,
		rut: 0x211d1a,
		dust: 0xb09773,
		stone: 0x626b67,
		mossEdge: 0x294d32,
	}),
	water: Object.freeze({
		shoreClear: 0x4f8577,
		lakeClear: 0x2b6878,
		riverPool: 0x256f7e,
		rapid: 0x8aafb0,
		deepSea: 0x07243a,
		abyss: 0x010911,
		plunge: 0x548893,
		splash: 0xe2efed,
		foam: 0xf3f8f5,
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
