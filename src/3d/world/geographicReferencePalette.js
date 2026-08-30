/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v32-fullworld-ecotone-separation',
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
		terrain: 'render-verified v32: cooler living meadow, olive-brown heath, warmer ferric mineral earth and wider granite/basalt/quartz separation so the existing deterministic world-space albedo/normal/roughness fabric reads as ecological and lithologic transitions at full-world scale without changing canonical terrain, shoreline, hydrology or colliders',
		water: 'render-only v29: slightly brighter mineral-green littoral and clearer river-pool separation while offshore deep/abyss values remain blue-black and canonical wet coverage/hydrology remain unchanged',
		road: 'warm compacted earth, dark damp ruts, pale mineral dust, cooler stone and restrained moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x10251a,
		meadow: 0x2f653a,
		dryHeather: 0x66513a,
		wetEarth: 0x19241d,
		exposedEarth: 0x9b6239,
		graniteShadow: 0x333e43,
		graniteSunlit: 0x9c8b74,
		basaltWet: 0x1d2930,
		quartz: 0xc4b79f,
	}),
	road: Object.freeze({
		compacted: 0x805f43,
		rut: 0x392e27,
		dust: 0xa68c6a,
		stone: 0x505654,
		mossEdge: 0x304b33,
	}),
	water: Object.freeze({
		shoreClear: 0x427872,
		lakeClear: 0x376f72,
		riverPool: 0x2f6d7b,
		rapid: 0x6598a1,
		deepSea: 0x0d344b,
		abyss: 0x03111d,
		plunge: 0x477987,
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
