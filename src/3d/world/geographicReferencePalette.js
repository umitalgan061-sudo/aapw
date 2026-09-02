/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-02-v74-aerial-lowland-ecotone-stratification',
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
		terrain: 'v74 follows direct inspection of the exact-head ad2b038 full-world artifact. v73 removed some chroma harshness but the central lowlands still read too close to one beige-olive value family at aerial scale. v74 widens the luminance/chroma spacing between damp meadow, dry heath, exposed soil and weathered stone so the existing deterministic world-space macro/meso/patch albedo, micro-normal and roughness domains resolve as ecological material transitions rather than a flat tint.',
		water: 'v74 retains the verified v72-v73 marine correction: deep sea and abyss stay readable without near-black crushing and coastal water remains cooler/desaturated. Coverage, bathymetry, lake membership, shoreline and offshore authority are unchanged.',
		road: 'v74 preserves established compacted-road and dust bases, keeping roads distinct from exposed-earth terrain without changing route geometry.',
		celestial: 'v74 preserves restrained noon and moon calibration; lowland depth is produced by material stratification, not by increasing global light intensity.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x09251a,
		meadow: 0x315a3d,
		dryHeather: 0x70563f,
		wetEarth: 0x101915,
		exposedEarth: 0x7c5038,
		graniteShadow: 0x232829,
		graniteSunlit: 0x9e9284,
		basaltWet: 0x091216,
		quartz: 0xbeb2a2,
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
