/**
 * Terrain biome shading policy and palette: the tunable numeric fields (measured percentile
 * telemetry, shore/snow/rock/forest thresholds, photogrammetry-inspired rock detail knobs) and the
 * base THREE.Color swatches every biome resolves toward, calibrated once at load against the shared
 * geographic reference palette. Pure static config plus one-time, deterministic colour calibration —
 * no per-frame logic lives here.
 *
 * Extracted from `terrainBiomeShading.js` (Run 359) to bring that file under GOVERNANCE.md's
 * 600-line file cap (Altın Kural 7) — a pure lossless move, zero value changes. This module has zero
 * imports from `terrainBiomeShading.js` itself (only `three` and the sibling
 * `geographicReferencePalette.js`), so `terrainBiomeShading.js` imports the policy/palette from here
 * and re-exports them unchanged under their original names/import path, keeping every existing
 * external `import { TERRAIN_BIOME_SHADING_POLICY, ... } from '.../terrainBiomeShading.js'` consumer
 * (checkCoastalCryosphereWidth.mjs, checkTerrainGeographicPalette.mjs, terrain.js and others) working
 * with no changes on their end. This keeps the split strictly one-directional: this module imports
 * nothing from `terrainBiomeShading.js`, which imports from it instead, avoiding a circular import
 * between the two files.
 * @module world/terrainBiomeShadingPolicy
 */

import * as THREE from 'three';
import { GEOGRAPHIC_REFERENCE_PALETTE, GEOGRAPHIC_REFERENCE_PALETTE_POLICY } from './geographicReferencePalette.js';

export const TERRAIN_BIOME_SHADING_POLICY = Object.freeze({
	id: 'terrain-map-climate-cryosphere-2026-08-24-v17-geological-rock',
	renderOnly: true,
	heightAuthorityUnchanged: true,
	mapAlignedCryosphere: true,
	snowSurfaceTone: true,
	geologicalRockSurface: true,
	measured: Object.freeze({
		probeGrid: '220x220 full-map + 200x200 land-only, live createHeightSampler',
		seaLevelMeters: 6,
		landFractionOfMap: 0.332,
		landHeightAboveSeaMeters: Object.freeze({ p10: 1.03, p25: 2.17, p50: 5.24, p75: 13.26, p80: 17.72, p85: 45.2, p90: 114.24, p95: 236.71, p98: 387.69, p99: 455.81, max: 566.34 }),
		landSlopeDegrees: Object.freeze({ p25: 0.34, p50: 0.6, p75: 4.78, p90: 31.67, p95: 44.44, p99: 62.51, max: 84.02 }),
		canonicalSnowCellHeightAboveSeaMeters: Object.freeze({ p25: 14.84, p50: 18.4, p75: 117.46, p90: 371.64 }),
		canonicalRockCellSlopeDegrees: Object.freeze({ p25: 6.16, p50: 23.68, p75: 38.56, p90: 49.86 }),
		overlayPng: Object.freeze({ meanSaturation: 0.4164, verdict: 'coloured-green-photo-texture', neutralisedAtLoad: true }),
	}),
	shoreSandTopMeters: 1.6,
	shoreSandFullMeters: 0.25,
	shoreEmergenceFullMeters: 0.6,
	northFrozenShoreTundraStrength: 0.84,
	northFrozenShoreIceStrength: 1,
	northFrozenSeabedStrength: 0.72,
	northCoastalIceTundraTopMeters: 1.8,
	northCoastalIceTundraFullMeters: 0.35,
	northCoastalIceTopMeters: 4.2,
	northCoastalIceFullMeters: 0.55,
	northCoastalIceStrength: 0.62,
	northCoastalIceTundraStrength: 0.20,
	northIntertidalTundraTopMeters: 0.72,
	northIntertidalIceTopMeters: 1.35,
	northIntertidalTundraStrength: 0.18,
	northIntertidalIceStrength: 0.36,
	northIntertidalSlopeFadeStartDegrees: 12,
	northIntertidalSlopeFadeFullDegrees: 30,
	northShallowIceTundraDepthMeters: 0.65,
	northShallowIceDepthMeters: 2.6,
	northShallowIceTundraStrength: 0.14,
	northShallowIceStrength: 0.68,
	grassMidStartMeters: 8,
	grassMidFullMeters: 60,
	dryUplandStartMeters: 60,
	dryUplandFullMeters: 190,
	rockSlopeStartDegrees: 22,
	rockSlopeFullDegrees: 45,
	canonicalRockGain: 0.85,
	rockCoolStartMeters: 80,
	rockCoolFullMeters: 320,
	// Photogrammetry-inspired rock treatment. These signals affect colour only; no geometry or
	// height is displaced, so roads/foundations/physics retain the canonical map-derived surface.
	rockStrataBandMeters: 27,
	rockStrataDipX: 0.018,
	rockStrataDipZ: -0.011,
	rockStrataWarpFrequency: 0.0014,
	rockStrataWarpMeters: 9,
	rockStrataStrength: 0.105,
	rockMineralFrequency: 0.00055,
	rockMineralStrength: 0.085,
	rockVeinFrequencyX: 0.029,
	rockVeinFrequencyZ: -0.021,
	rockVeinHeightFrequency: 0.041,
	rockVeinWarpFrequency: 0.0018,
	rockVeinWidth: 0.115,
	rockVeinStrength: 0.13,
	rockErosionFrequencyX: 0.017,
	rockErosionFrequencyZ: 0.031,
	rockErosionWarpFrequency: 0.0011,
	rockErosionWidth: 0.16,
	rockErosionSlopeStartDegrees: 30,
	rockErosionSlopeFullDegrees: 55,
	rockErosionStrength: 0.11,
	snowAltitudeStartMeters: 380,
	snowAltitudeFullMeters: 580,
	northTundraSnowlineStartMeters: 205,
	northTundraSnowlineFullMeters: 395,
	northIceSnowlineStartMeters: 0,
	northIceSnowlineFullMeters: 135,
	canonicalSnowGain: 1,
	snowShedStartDegrees: 40,
	snowShedFullDegrees: 58,
	snowDriftSlopeFullDegrees: 8,
	snowDriftSlopeFadeDegrees: 28,
	northSnowDriftGain: 0.14,
	tundraSnowDriftGain: 0.06,
	snowConcavityFullMeters: 4.5,
	snowConvexityFullMeters: 3.5,
	northConcavitySnowGain: 0.08,
	tundraConcavitySnowGain: 0.045,
	northRidgeScourMax: 0.10,
	tundraRidgeScourMax: 0.06,
	northIceFullNormalizedY: 0.12,
	northIceFadeNormalizedY: 0.29,
	northTundraFadeNormalizedY: 0.38,
	northSnowMinimumCoverage: 0.94,
	northTundraLowlandSnowFloor: 0.16,
	northIceLowlandTintStrength: 0.30,
	northIceTransitionLowlandTintGain: 0.07,
	northIceLowlandTintFadeStartMeters: 45,
	northIceLowlandTintFadeFullMeters: 220,
	northMoraineSlopeStartDegrees: 28,
	northMoraineSlopeFullDegrees: 52,
	northMoraineMaxStrength: 0.22,
	forestPatchFrequency: 0.00095,
	forestPatchOctaves: 4,
	forestPatchStart: 0.40,
	forestPatchFull: 0.68,
	forestSlopeFalloffStartDegrees: 30,
	forestSlopeFalloffFullDegrees: 46,
	forestTreeLineStartMeters: 170,
	forestTreeLineFullMeters: 330,
	forestMaxStrength: 0.88,
	grassVariationFrequency: 0.00042,
	grassVariationStrength: 0.30,
	seabedFullDepthMeters: 2.5,
	mottleAmplitude: 0.075,
	mottleCellMeters: 37,
	detailTextureSize: 2048,
	detailMinMultiplier: 0.62,
	detailMaxMultiplier: 1.45,
	detailEncodePivot: 128,
});

export const NEUTRAL_DETAIL_GAIN = 255 / TERRAIN_BIOME_SHADING_POLICY.detailEncodePivot;

export const TERRAIN_BIOME_PALETTE = Object.freeze({
	SEABED: new THREE.Color(0x3c514b),
	NORTH_SEABED: new THREE.Color(0x536d72),
	GLACIAL_SHALLOW: new THREE.Color(0x9bbbc2),
	SHORE_SAND: new THREE.Color(0xc9bf9f),
	FROZEN_SHORE: new THREE.Color(0xaab5ad),
	GLACIAL_SHORE: new THREE.Color(0xc5d6d8),
	WET_FROZEN_SHORE: new THREE.Color(0x83979a),
	COASTAL_ICE: new THREE.Color(0xd2e2e5),
	GRASS_LOW: new THREE.Color(0x718b42),
	MEADOW: new THREE.Color(0x82984e),
	GRASS_MID: new THREE.Color(0x78834a),
	HEATH: new THREE.Color(0x77724b),
	DRY_UPLAND: new THREE.Color(0x918657),
	TUNDRA: new THREE.Color(0x77806f),
	FOREST: new THREE.Color(0x354d2b),
	ROCK_WARM: new THREE.Color(0x6c6257),
	ROCK_COOL: new THREE.Color(0x777a79),
	ROCK_STRATA_LIGHT: new THREE.Color(0x82786d),
	ROCK_IRON: new THREE.Color(0x806650),
	ROCK_QUARTZ: new THREE.Color(0xb8b1a6),
	ROCK_EROSION: new THREE.Color(0x504f4b),
	MORAINE: new THREE.Color(0x6f7776),
	GLACIAL_ICE: new THREE.Color(0xdceaf0),
	SNOW: new THREE.Color(0xf4f6f7),
	PACKED_SNOW: new THREE.Color(0xdce8ed),
	ACCUMULATED_SNOW: new THREE.Color(0xf8f5ef),
});

// Additive photogrammetry calibration: the proven biome classifier above still decides *where*
// every surface appears; these restrained blends only align its output with the shared real-world
// palette. Object.freeze protects the palette shape while THREE.Color remains intentionally mutable.
const REFERENCE_TERRAIN = GEOGRAPHIC_REFERENCE_PALETTE.terrain;
TERRAIN_BIOME_PALETTE.GRASS_LOW.lerp(new THREE.Color(REFERENCE_TERRAIN.meadow), 0.34);
TERRAIN_BIOME_PALETTE.MEADOW.lerp(new THREE.Color(REFERENCE_TERRAIN.meadow), 0.42);
TERRAIN_BIOME_PALETTE.GRASS_MID.lerp(new THREE.Color(REFERENCE_TERRAIN.dryHeather), 0.30);
TERRAIN_BIOME_PALETTE.HEATH.lerp(new THREE.Color(REFERENCE_TERRAIN.dryHeather), 0.48);
TERRAIN_BIOME_PALETTE.DRY_UPLAND.lerp(new THREE.Color(REFERENCE_TERRAIN.exposedEarth), 0.32);
TERRAIN_BIOME_PALETTE.FOREST.lerp(new THREE.Color(REFERENCE_TERRAIN.mossShadow), 0.46);
TERRAIN_BIOME_PALETTE.ROCK_WARM.lerp(new THREE.Color(REFERENCE_TERRAIN.graniteSunlit), 0.34);
TERRAIN_BIOME_PALETTE.ROCK_COOL.lerp(new THREE.Color(REFERENCE_TERRAIN.graniteShadow), 0.38);
TERRAIN_BIOME_PALETTE.ROCK_EROSION.lerp(new THREE.Color(REFERENCE_TERRAIN.basaltWet), 0.46);
TERRAIN_BIOME_PALETTE.ROCK_IRON.lerp(new THREE.Color(REFERENCE_TERRAIN.exposedEarth), 0.32);
TERRAIN_BIOME_PALETTE.ROCK_QUARTZ.lerp(new THREE.Color(REFERENCE_TERRAIN.quartz), 0.44);
TERRAIN_BIOME_PALETTE.ROCK_STRATA_LIGHT.lerp(new THREE.Color(REFERENCE_TERRAIN.graniteSunlit), 0.58);
TERRAIN_BIOME_PALETTE.ROCK_EROSION.lerp(new THREE.Color(REFERENCE_TERRAIN.basaltWet), 0.24);
TERRAIN_BIOME_PALETTE.ROCK_IRON.lerp(new THREE.Color(REFERENCE_TERRAIN.exposedEarth), 0.18);

export const TERRAIN_REFERENCE_PALETTE_CALIBRATION = Object.freeze({
	policyId: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id,
	classificationAuthorityUnchanged: true,
	photogrammetryCalibrated: true,
});
