/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-08-30-v42-ground-water-separation',
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
		terrain: 'render-calibrated v42: damp organic lowlands, living meadow, dry heath, ferric exposure and mineral rock families retain broader aerial separation without saturation; existing deterministic world-space albedo/normal/roughness fabric remains the variation source and canonical terrain, shoreline, hydrology and colliders are unchanged',
		water: 'render-calibrated v42: shallow mineral-green shore water, inland pools, aerated rapids and offshore depth keep a clearer optical hierarchy without changing canonical wet coverage, shoreline or hydrology',
		road: 'render-calibrated v42: compacted earth, wet ruts, pale mineral dust and cool stone shoulders remain materially distinct without a uniform painted-ribbon response',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x10281a,
		meadow: 0x315e38,
		dryHeather: 0x825f3e,
		wetEarth: 0x151d19,
		exposedEarth: 0xad7045,
		graniteShadow: 0x33444d,
		graniteSunlit: 0xa89076,
		basaltWet: 0x15262e,
		quartz: 0xcbbda8,
	}),
	road: Object.freeze({
		compacted: 0x73513a,
		rut: 0x30271f,
		dust: 0xb59c79,
		stone: 0x606865,
		mossEdge: 0x2a4e32,
	}),
	water: Object.freeze({
		shoreClear: 0x50877c,
		lakeClear: 0x306b78,
		riverPool: 0x276f80,
		rapid: 0x7faeb2,
		deepSea: 0x08283d,
		abyss: 0x020a13,
		plunge: 0x518893,
		splash: 0xddecea,
		foam: 0xf0f6f3,
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
