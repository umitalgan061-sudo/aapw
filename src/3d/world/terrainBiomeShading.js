/**
 * Render-only geographic terrain shading. Canonical map/Pindex data remains height authority; this
 * module only resolves believable surface colour from altitude, slope, canonical rock/snow weights
 * and latitude on the owner 9000x7000 map.
 * @module world/terrainBiomeShading
 */

import * as THREE from 'three';
import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { signedFbmNoise } from './terrainReliefDetail.js';

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

export const TERRAIN_BIOME_SHADING_POLICY = Object.freeze({
	id: 'terrain-slope-altitude-biome-shading-2026-08-19-v1',
	renderOnly: true,
	heightAuthorityUnchanged: true,
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
	grassMidStartMeters: 8,
	grassMidFullMeters: 60,
	dryUplandStartMeters: 60,
	dryUplandFullMeters: 190,
	rockSlopeStartDegrees: 22,
	rockSlopeFullDegrees: 45,
	canonicalRockGain: 0.85,
	rockCoolStartMeters: 80,
	rockCoolFullMeters: 320,
	snowAltitudeStartMeters: 380,
	snowAltitudeFullMeters: 580,
	canonicalSnowGain: 1,
	snowShedStartDegrees: 40,
	snowShedFullDegrees: 58,
	// map.png is top-down: normalized Y=0 is the far north. 0.12 (~840 map units) is permanent
	// cryosphere; 0.29 (~2030 units) is the end of the snow/tundra transition.
	northIceFullNormalizedY: 0.12,
	northIceFadeNormalizedY: 0.29,
	northTundraFadeNormalizedY: 0.38,
	northSnowMinimumCoverage: 0.94,
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

/** Natural, low-saturation geography palette derived from the visual language of map.png rather than
 * one uniform green overlay. Values intentionally remain conservative so PBR lighting does the work. */
export const TERRAIN_BIOME_PALETTE = Object.freeze({
	SEABED: new THREE.Color(0x3c514b),
	SHORE_SAND: new THREE.Color(0xc9bf9f),
	GRASS_LOW: new THREE.Color(0x718b42),
	MEADOW: new THREE.Color(0x82984e),
	GRASS_MID: new THREE.Color(0x78834a),
	HEATH: new THREE.Color(0x77724b),
	DRY_UPLAND: new THREE.Color(0x918657),
	TUNDRA: new THREE.Color(0x77806f),
	FOREST: new THREE.Color(0x354d2b),
	ROCK_WARM: new THREE.Color(0x6c6257),
	ROCK_COOL: new THREE.Color(0x777a79),
	GLACIAL_ICE: new THREE.Color(0xdceaf0),
	SNOW: new THREE.Color(0xf4f6f7),
});

function positionHash01(worldX, worldZ) {
	const cell = TERRAIN_BIOME_SHADING_POLICY.mottleCellMeters;
	const qx = Math.round(worldX / cell);
	const qz = Math.round(worldZ / cell);
	const value = Math.sin(qx * 127.1 + qz * 311.7) * 43758.5453;
	return value - Math.floor(value);
}

function normalizedMapYAtWorldZ(worldZ) {
	const bounds = WORLD_SCALE.MAP_BOUNDS;
	const centerMapY = (bounds.minY + bounds.maxY) * 0.5;
	const mapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	return clamp01(mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits);
}

const scratchRock = new THREE.Color();
const scratchGround = new THREE.Color();

export function resolveTerrainBiomeColor(target, {
	heightAboveSeaMeters,
	slopeDegrees,
	rockWeight = 0,
	snowWeight = 0,
	worldX = 0,
	worldZ = 0,
}) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	const height = heightAboveSeaMeters;
	const slope = slopeDegrees;
	const normalizedY = normalizedMapYAtWorldZ(worldZ);
	const permanentNorth = 1 - smoothstep(P.northIceFullNormalizedY, P.northIceFadeNormalizedY, normalizedY);
	const tundraNorth = 1 - smoothstep(P.northIceFadeNormalizedY, P.northTundraFadeNormalizedY, normalizedY);

	// Open ground: meadow/grass/heath/dry upland. This keeps map.png's geographic family but removes
	// the single green sheet that made plains, scrub and uplands indistinguishable.
	const drift = signedFbmNoise(worldX * P.grassVariationFrequency + 5.3, worldZ * P.grassVariationFrequency - 2.9, 3);
	const meadowAmount = clamp01(0.45 + drift * 0.35);
	scratchGround.copy(TERRAIN_BIOME_PALETTE.GRASS_LOW).lerp(TERRAIN_BIOME_PALETTE.MEADOW, meadowAmount);
	target.copy(scratchGround)
		.lerp(TERRAIN_BIOME_PALETTE.GRASS_MID, smoothstep(P.grassMidStartMeters, P.grassMidFullMeters, height))
		.lerp(TERRAIN_BIOME_PALETTE.HEATH, clamp01(smoothstep(35, 115, height) + Math.max(0, -drift) * 0.22))
		.lerp(TERRAIN_BIOME_PALETTE.DRY_UPLAND, smoothstep(P.dryUplandStartMeters, P.dryUplandFullMeters, height));
	if (tundraNorth > 0) target.lerp(TERRAIN_BIOME_PALETTE.TUNDRA, tundraNorth * 0.78);

	// Forest remains patch-driven, but disappears toward the frozen north and above the tree line.
	const forestNoise01 = signedFbmNoise(worldX * P.forestPatchFrequency - 13.1, worldZ * P.forestPatchFrequency + 7.4, P.forestPatchOctaves) * 0.5 + 0.5;
	const forestPatch = smoothstep(P.forestPatchStart, P.forestPatchFull, forestNoise01);
	const notCliff = 1 - smoothstep(P.forestSlopeFalloffStartDegrees, P.forestSlopeFalloffFullDegrees, slope);
	const belowTreeLine = 1 - smoothstep(P.forestTreeLineStartMeters, P.forestTreeLineFullMeters, height);
	const forestAmount = forestPatch * notCliff * belowTreeLine * P.forestMaxStrength * (1 - permanentNorth) * (1 - tundraNorth * 0.62);
	if (forestAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.FOREST, forestAmount);

	const sandAmount = (1 - smoothstep(P.shoreSandFullMeters, P.shoreSandTopMeters, height))
		* (1 - smoothstep(P.rockSlopeStartDegrees, P.rockSlopeFullDegrees, slope))
		* (height > 0 ? 1 : 0)
		* (1 - permanentNorth);
	if (sandAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.SHORE_SAND, sandAmount);

	const rockAmount = clamp01(Math.max(
		smoothstep(P.rockSlopeStartDegrees, P.rockSlopeFullDegrees, slope),
		clamp01(rockWeight) * P.canonicalRockGain,
	));
	if (rockAmount > 0) {
		scratchRock.copy(TERRAIN_BIOME_PALETTE.ROCK_WARM)
			.lerp(TERRAIN_BIOME_PALETTE.ROCK_COOL, smoothstep(P.rockCoolStartMeters, P.rockCoolFullMeters, height));
		target.lerp(scratchRock, rockAmount);
	}

	// Snow authority: canonical snow + altitude + a latitude floor. In the permanent cryosphere the
	// latitude floor wins even on low terrain, fixing the green far-north visible in the current build.
	const authoredSnow = Math.max(
		smoothstep(P.snowAltitudeStartMeters, P.snowAltitudeFullMeters, height),
		clamp01(snowWeight) * P.canonicalSnowGain,
	);
	const northSnowSupply = permanentNorth * P.northSnowMinimumCoverage;
	const snowSupply = clamp01(Math.max(authoredSnow, northSnowSupply, tundraNorth * 0.58));
	const naturalHold = 1 - smoothstep(P.snowShedStartDegrees, P.snowShedFullDegrees, slope);
	const snowHold = lerp(naturalHold, Math.max(naturalHold, 0.96), permanentNorth);
	const snowAmount = height > 0 ? clamp01(snowSupply * snowHold) : 0;
	if (snowAmount > 0) {
		// A restrained ice-blue undertone prevents the north from reading as featureless pure white.
		target.lerp(TERRAIN_BIOME_PALETTE.GLACIAL_ICE, permanentNorth * 0.22);
		target.lerp(TERRAIN_BIOME_PALETTE.SNOW, snowAmount);
	}

	const submergedAmount = 1 - smoothstep(-P.seabedFullDepthMeters, 0, height);
	if (submergedAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.SEABED, submergedAmount);

	const mottleStrength = P.mottleAmplitude * (1 - permanentNorth * 0.45);
	const mottle = 1 + (positionHash01(worldX, worldZ) - 0.5) * 2 * mottleStrength;
	target.setRGB(clamp01(target.r * mottle), clamp01(target.g * mottle), clamp01(target.b * mottle));
	return target;
}

export function buildNeutralDetailCanvas(image, { size = TERRAIN_BIOME_SHADING_POLICY.detailTextureSize } = {}) {
	const canvas = document.createElement('canvas');
	canvas.width = size;
	canvas.height = size;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	context.drawImage(image, 0, 0, size, size);
	const imageData = context.getImageData(0, 0, size, size);
	const data = imageData.data;
	let sum = 0;
	for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
	const safeMean = Math.max(1, sum / (data.length / 4));
	const { detailMinMultiplier, detailMaxMultiplier, detailEncodePivot } = TERRAIN_BIOME_SHADING_POLICY;
	for (let i = 0; i < data.length; i += 4) {
		const luma = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
		const multiplier = Math.max(detailMinMultiplier, Math.min(detailMaxMultiplier, luma / safeMean));
		const encoded = Math.max(0, Math.min(255, Math.round(multiplier * detailEncodePivot)));
		data[i] = encoded;
		data[i + 1] = encoded;
		data[i + 2] = encoded;
		data[i + 3] = 255;
	}
	context.putImageData(imageData, 0, 0);
	return canvas;
}

export function buildFlatNeutralCanvas() {
	const canvas = document.createElement('canvas');
	canvas.width = 1;
	canvas.height = 1;
	const context = canvas.getContext('2d');
	const pivot = TERRAIN_BIOME_SHADING_POLICY.detailEncodePivot;
	context.fillStyle = `rgb(${pivot}, ${pivot}, ${pivot})`;
	context.fillRect(0, 0, 1, 1);
	return canvas;
}

export function slopeDegreesFromNeighbours(heightWest, heightEast, heightNorth, heightSouth, spacingMeters) {
	const gradientX = (heightEast - heightWest) / (2 * spacingMeters);
	const gradientZ = (heightSouth - heightNorth) / (2 * spacingMeters);
	return Math.atan(Math.hypot(gradientX, gradientZ)) * 180 / Math.PI;
}
