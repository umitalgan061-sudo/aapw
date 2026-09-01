/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-02-v80-aerial-material-and-depth-ordering',
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
		terrain: 'v80 keeps the v79 aerial material-family separation: meadow is deeper/less yellow, dry heather is less orange, exposed earth is less luminous, and granite/quartz remain neutral so existing world-space geological fabric, weathering and ecological transitions read instead of collapsing into one beige field. Canonical biome placement, terrain geometry, cryosphere masks, coastline, hydrology and colliders remain unchanged.',
		water: 'v80 restores the minimum physically ordered deepSea-to-abyss luminance step required by the shared material contract while keeping the colours only one RGB code-step family apart; kilometre/meso/fine world-space fabric, current shear, roughness and bathymetric optical response remain the dominant deterministic depth variation. Canonical bathymetry, wet coverage, shoreline, lake membership, water geometry and colliders remain unchanged.',
		road: 'v80 preserves the v77 compacted-earth versus rut/stone separation while retaining canonical routes and world-space wear.',
		celestial: 'warm low sun, neutral noon and cool moon remain separated while preserving terrain and water material readability',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x0d2115,
		meadow: 0x2f7040,
		dryHeather: 0x66523d,
		wetEarth: 0x101a15,
		exposedEarth: 0x956b49,
		graniteShadow: 0x303a40,
		graniteSunlit: 0x817d78,
		basaltWet: 0x101d22,
		quartz: 0x98928b,
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
