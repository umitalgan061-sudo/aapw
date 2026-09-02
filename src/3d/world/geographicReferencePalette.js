/**
 * Shared render-only palette calibrated from the owner's photogrammetry references and the
 * repository's dirt-road / rocky-terrain assets. Numeric world authority is deliberately absent:
 * terrain height, hydrology, routes, collision and the day clock remain owned by their existing
 * systems. Keeping the colours here prevents each material from inventing a different geography.
 * @module world/geographicReferencePalette
 */

export const GEOGRAPHIC_REFERENCE_PALETTE_POLICY = Object.freeze({
	id: 'geographic-reference-palette-2026-09-02-v71-aerial-ecotone-depth',
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
		terrain: 'v71 follows direct inspection of exact-head full-world #1186: canonical geography and relief remain stable, but broad central lowlands still flatten into a similar beige-olive value at aerial distance and some rocky belts merge into adjacent exposed soil. Meadow and moss are separated more strongly from dry heath, exposed earth is kept warmer but slightly darker, and granite shadow/sunlit values are pulled farther apart so ridge and cliff material reads without changing terrain height, shoreline, hydrology, collider, biome or map-derived geography.',
		water: 'v71 preserves the v70 shallow/lake/deep-sea hierarchy and coverage/depth/offshore authority; shoreline, lake membership and bathymetry remain untouched.',
		road: 'v71 preserves established compacted-road and dust bases, keeping roads distinct from exposed-earth terrain without changing route geometry.',
		celestial: 'v71 preserves the restrained noon and moon calibration so the new terrain value separation remains visible under both daylight and night lighting.',
	}),
});

export const GEOGRAPHIC_REFERENCE_PALETTE = Object.freeze({
	terrain: Object.freeze({
		mossShadow: 0x062416,
		meadow: 0x347346,
		dryHeather: 0x624735,
		wetEarth: 0x0b1812,
		exposedEarth: 0x935438,
		graniteShadow: 0x131e25,
		graniteSunlit: 0xb0a393,
		basaltWet: 0x02090d,
		quartz: 0xc5baa9,
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
