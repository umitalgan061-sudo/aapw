/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-02-v84-aerial-biome-separation',
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
		terrain: 'v84 follows direct exact-head full-world inspection of v83, where broad lowlands still merged into a muddy olive-grey family at aerial scale. Temperate meadow is lifted toward a clearer natural green, dry heather gains a restrained ochre-mineral separation, exposed earth darkens slightly so it no longer washes over vegetation, and sunlit granite is cooled/darkened relative to quartz. Existing world-space geological fabric, weathering, erosion and ecological transitions still own local breakup; canonical biome placement, terrain geometry, cryosphere masks, coastline, hydrology and colliders remain unchanged.',
		water: 'v84 preserves the minimum physically ordered deepSea-to-abyss luminance step; kilometre/meso/fine world-space fabric, current shear, roughness and bathymetric optical response remain the dominant deterministic depth variation. Canonical bathymetry, wet coverage, shoreline, lake membership, water geometry and colliders remain unchanged.',
		road: 'v84 preserves compacted-earth versus rut/stone separation while retaining canonical routes and world-space wear.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0d2a18,
		meadow: 0x4f8554,
		dryHeather: 0x7b5f43,
		wetEarth: 0x132018,
		exposedEarth: 0x6d4b38,
		graniteShadow: 0x253137,
		graniteSunlit: 0x59656b,
		basaltWet: 0x0f1b20,
		quartz: 0xaaa399,
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
