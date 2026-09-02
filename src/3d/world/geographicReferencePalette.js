/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-02-v70-aerial-material-depth',
	renderOnly: true,
	deterministic: true,
	heightAuthorityUnchanged: true,
	hydrologyAuthorityUnchanged: true,
	routeAuthorityUnchanged: true,
	ecotoneContrastRaised: true,
	wetDryValueSeparationRaised: true,
	rockValueCompressionReduced: true,
	waterDepthHierarchyRaised: true,
	aerialChromaRecovery: true,
	aerialLowlandMaterialSeparationRaised: true,
	aerialLowlandDepthRaised: true,
	aerialRockSoilSeparationRaised: true,
	openWaterValueSeparationRaised: true,
	legacyRoadBaseContractPreserved: true,
	exposedRockSeparationRaised: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v70 follows exact-head full-world inspection after v69: lowlands gained separation but exposed soil and sunlit rock still merged at aerial distance. Meadow stays cool/deep, dry heather shifts slightly darker and less orange, exposed earth remains oxidized but lower-value, and granite/quartz are separated from soil without bleaching mountain faces. Height, shoreline, collider, biome and map-derived geography remain unchanged.',
		water: 'v70 increases shallow/lake/deep-sea value spacing while preserving the existing coverage/depth/offshore authority. It changes optical colour only; shoreline, lake membership and bathymetry are untouched.',
		road: 'v70 preserves established compacted-road and dust bases, keeping roads distinct from exposed-earth terrain without changing route geometry.',
		celestial: 'v70 slightly restrains noon warmth and moon blue so terrain, ice and water material values remain readable instead of being washed into one lighting tint.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x082819,
		meadow: 0x2f6840,
		dryHeather: 0x6f503d,
		wetEarth: 0x0d1a14,
		exposedEarth: 0x9d5e40,
		graniteShadow: 0x18232a,
		graniteSunlit: 0xa99c8d,
		basaltWet: 0x020b0f,
		quartz: 0xc0b5a4,
	}),
	road: Object.freeze({
		compacted: 0x866347,
		rut: 0x1b1917,
		dust: 0xaa8b67,
		stone: 0x68706a,
		mossEdge: 0x2c5435,
	}),
	water: Object.freeze({
		shoreClear: 0x5a927f,
		lakeClear: 0x286879,
		riverPool: 0x247182,
		rapid: 0x88adaf,
		deepSea: 0x113f55,
		abyss: 0x082632,
		plunge: 0x518996,
		splash: 0xe1eeec,
		foam: 0xf2f7f4,
	}),
	celestial: Object.freeze({
		dawn: 0xffae63,
		noon: 0xffefd6,
		sunset: 0xff8750,
		moon: 0xc6d8f6,
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
