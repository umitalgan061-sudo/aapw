/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-02-v75-lowland-ecological-material-depth',
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
	coastalGreenCastReduced: true,
	deepMarineBlackCrushReduced: true,
	legacyRoadBaseContractPreserved: true,
	exposedRockSeparationRaised: true,
	assetReferences: Object.freeze([
		'assets/models/fbx/dirt_road_test.glb',
		'assets/models/fbx/road_terrain.glb',
		'assets/models/fbx/rocky_terrain_low_poly.glb',
		'assets/models/fbx/rugged_mountain_landscape.glb',
	]),
	calibration: Object.freeze({
		terrain: 'v75 follows direct inspection of the exact-head 4169eb0 full-world WebGL artifact. Relief is readable, but the broad central lowlands still collapse into a beige-grey family at aerial scale. v75 shifts living meadow toward a deeper natural green, dry heath toward a darker desaturated umber, and exposed mineral soil toward a warmer oxidised brown while keeping wet soil and rock distinctly darker. Existing deterministic world-space macro/meso/patch albedo, normal and roughness variation remains authoritative for local breakup; this palette only improves ecological material separation.',
		water: 'v75 retains the verified v72-v74 marine correction: deep sea and abyss stay readable without near-black crushing and coastal water remains cooler/desaturated. Coverage, bathymetry, lake membership, shoreline and offshore authority are unchanged.',
		road: 'v75 preserves established compacted-road and dust bases, keeping roads distinct from exposed-earth terrain without changing route geometry.',
		celestial: 'v75 preserves restrained noon and moon calibration; lowland depth is produced by material stratification, not by increasing global light intensity.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x082219,
		meadow: 0x28543a,
		dryHeather: 0x654b38,
		wetEarth: 0x0e1814,
		exposedEarth: 0x815038,
		graniteShadow: 0x202627,
		graniteSunlit: 0xa29587,
		basaltWet: 0x081115,
		quartz: 0xc0b5a5,
	}),
	road: Object.freeze({
		compacted: 0x866347,
		rut: 0x1b1917,
		dust: 0xaa8b67,
		stone: 0x68706a,
		mossEdge: 0x2c5435,
	}),
	water: Object.freeze({
		shoreClear: 0x4d8278,
		lakeClear: 0x286373,
		riverPool: 0x247182,
		rapid: 0x88adaf,
		deepSea: 0x174b62,
		abyss: 0x0b3040,
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
