/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-02-v87-aerial-ecotone-contrast',
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
		terrain: 'v87 is the second same-run production iteration after direct comparison of the v86 exact-head full-world render with the run-start render. v86 moved the material families in the correct direction but broad temperate lowland, dry heath/exposed-earth and cool mountain rock still merged too readily after the existing aerial desaturation and moisture shader passes. Meadow therefore receives a slightly deeper forest-adjacent green value, dry heather a clearer ochre/mineral hue, exposed earth a darker red-brown mineral base, and granite a wider cool shadow-to-sunlit separation. Existing deterministic world-space albedo/normal/roughness, drainage, erosion, scree, coastal weathering and ecological transition masks remain responsible for local breakup; canonical biome placement, terrain geometry, cryosphere masks, coastline, hydrology and colliders remain unchanged.',
		water: 'v87 preserves the physically ordered deepSea-to-abyss relationship and all existing kilometre/meso/fine world-space marine fabric, current shear, roughness, organic near/far handoff and bathymetric optical response. Canonical bathymetry, wet coverage, shoreline, lake membership, water geometry and colliders remain unchanged.',
		road: 'v87 preserves compacted-earth versus rut/stone separation while retaining canonical routes and world-space wear.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x092313,
		meadow: 0x477b4c,
		dryHeather: 0x916841,
		wetEarth: 0x101b14,
		exposedEarth: 0x54392b,
		graniteShadow: 0x1f2b32,
		graniteSunlit: 0x626f74,
		basaltWet: 0x0c171c,
		quartz: 0xaca59b,
	}),
	road: Object.freeze({
		compacted: 0x70503b,
		rut: 0x26211e,
		dust: 0xad9270,
		stone: 0x606967,
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
