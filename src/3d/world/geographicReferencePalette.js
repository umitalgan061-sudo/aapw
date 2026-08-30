/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v35-fullworld-ecotone-relief-readability',
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
		terrain: 'render-verified v35: stronger but natural full-world meadow/heath/damp-soil/ferric-earth separation plus deeper cool rock shadow and warmer weathered faces so existing deterministic world-space fabric reads through aerial tonemapping without changing canonical terrain, shoreline, hydrology or colliders',
		water: 'render-verified v35: mineral-green littoral remains distinct from cooler lake/river water while offshore deep/abyss stay blue-black; canonical wet coverage, shoreline and hydrology remain unchanged',
		road: 'warm compacted earth, dark damp ruts, pale mineral dust, cooler stone and restrained moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x102619,
		meadow: 0x2f6637,
		dryHeather: 0x6d5437,
		wetEarth: 0x19251d,
		exposedEarth: 0xa36b3d,
		graniteShadow: 0x2f3b43,
		graniteSunlit: 0xa18c74,
		basaltWet: 0x1b2a33,
		quartz: 0xcbbea5,
	}),
	road: Object.freeze({
		compacted: 0x805f43,
		rut: 0x392e27,
		dust: 0xa68c6a,
		stone: 0x505654,
		mossEdge: 0x304b33,
	}),
	water: Object.freeze({
		shoreClear: 0x4a8176,
		lakeClear: 0x376d72,
		riverPool: 0x2b6b7b,
		rapid: 0x6598a1,
		deepSea: 0x0b3046,
		abyss: 0x020f1a,
		plunge: 0x467986,
		splash: 0xd9e9e7,
		foam: 0xf0f7f4,
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
