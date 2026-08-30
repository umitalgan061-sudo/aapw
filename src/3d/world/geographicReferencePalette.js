/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v36-natural-material-separation',
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
		terrain: 'render-only v36: broader natural material-family separation lets existing deterministic world-space albedo/normal/roughness fabric remain legible at full-world distance; damp vegetation stays cool, exposed mineral soil warmer, granite faces less beige, wet basalt darker and quartz restrained without changing canonical terrain, shoreline, hydrology or colliders',
		water: 'render-only v36: littoral mineral-green, inland cold water and blue-black offshore depth remain distinct without changing canonical wet coverage, shoreline, river/lake ownership or hydrology',
		road: 'render-only v36: compacted earth, damp ruts, mineral dust and stone shoulders retain distinct natural values so road material response does not collapse into a single brown strip',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x11291b,
		meadow: 0x326a3a,
		dryHeather: 0x74593a,
		wetEarth: 0x18231c,
		exposedEarth: 0xa87343,
		graniteShadow: 0x34434b,
		graniteSunlit: 0x978674,
		basaltWet: 0x182832,
		quartz: 0xc4b9a4,
	}),
	road: Object.freeze({
		compacted: 0x7c5c40,
		rut: 0x342a24,
		dust: 0xad9270,
		stone: 0x555b58,
		mossEdge: 0x2d4d34,
	}),
	water: Object.freeze({
		shoreClear: 0x4d8578,
		lakeClear: 0x356b73,
		riverPool: 0x296d7d,
		rapid: 0x689ca5,
		deepSea: 0x092d43,
		abyss: 0x020d17,
		plunge: 0x477d89,
		splash: 0xddecea,
		foam: 0xf1f8f5,
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
