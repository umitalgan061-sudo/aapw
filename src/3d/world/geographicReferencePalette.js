/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-28-v1-photogrammetry-calibrated',
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
		terrain: 'moss-and-heather lowlands, exposed mineral earth, warm granite and wet basalt',
		water: 'bed-readable green-cyan shallows, dark blue depth, aerated neutral-white falls',
		road: 'warm compacted earth, dark damp ruts, mineral dust, stone and moss shoulders',
		celestial: 'warm low sun, neutral noon, cool moon with preserved material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x29452f,
		meadow: 0x607347,
		dryHeather: 0x75654d,
		wetEarth: 0x484239,
		exposedEarth: 0x8a6245,
		graniteShadow: 0x535958,
		graniteSunlit: 0x9c755c,
		basaltWet: 0x30383a,
		quartz: 0xb6aea1,
	}),
	road: Object.freeze({
		compacted: 0x8b6849,
		rut: 0x4d3b2e,
		dust: 0xb0926d,
		stone: 0x5c574d,
		mossEdge: 0x40523a,
	}),
	water: Object.freeze({
		shoreClear: 0x6aa39c,
		lakeClear: 0x53877f,
		riverPool: 0x57756e,
		rapid: 0x4b7e89,
		deepSea: 0x092941,
		abyss: 0x061723,
		plunge: 0x4a6e75,
		splash: 0xd9e9e7,
		foam: 0xeff8f7,
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

