/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-01-v67-ocean-depth-rebalance',
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
		terrain: 'v67 preserves v56 aerial lowland ecotone separation and all canonical terrain, shoreline, hydrology and collider authority unchanged',
		water: 'v67 follows direct inspection of exact-head full-world #866: v66 removed the near-black ocean problem but lifted deep water enough that open sea lost depth separation. DeepSea and abyss are therefore pulled down together by a restrained amount while retaining their close hierarchy, leaving deterministic world-space macro/meso/fine albedo, pseudo-normal, roughness, current and glint as the anti-uniformity signal. Wet coverage, shoreline, bathymetry, lake membership and water geometry remain unchanged.',
		road: 'v67 preserves darker damp ruts and subdued mineral dust so canonical roads stay materially worn rather than painted ribbons',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x021109,
		meadow: 0x0b4e25,
		dryHeather: 0x423825,
		wetEarth: 0x07110d,
		exposedEarth: 0x965337,
		graniteShadow: 0x293135,
		graniteSunlit: 0x5d5952,
		basaltWet: 0x07141a,
		quartz: 0x6b655d,
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
		deepSea: 0x24596a,
		abyss: 0x235666,
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
