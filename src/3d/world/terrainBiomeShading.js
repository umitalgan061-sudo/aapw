/**
 * Render-only geographic terrain shading. Canonical map/Pindex data remains height authority; this
 * module only resolves believable surface colour from altitude, slope, canonical rock/snow weights
 * and the owner map's geographic climate fields.
 * @module world/terrainBiomeShading
 */

import * as THREE from 'three';
import { WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { northReferenceCryosphereAtWorldXZ } from './northReferenceCryosphere.js';
import { signedFbmNoise } from './terrainReliefDetail.js';
import { resolveTerrainWindSnowAdjustment } from './terrainWindSnowExposure.js';

const clamp01 = (value) => (value < 0 ? 0 : value > 1 ? 1 : value);
const lerp = (a, b, t) => a + (b - a) * t;
function smoothstep(edge0, edge1, value) {
	if (edge0 === edge1) return value >= edge1 ? 1 : 0;
	const t = clamp01((value - edge0) / (edge1 - edge0));
	return t * t * (3 - 2 * t);
}

export const TERRAIN_BIOME_SHADING_POLICY = Object.freeze({
	id: 'terrain-map-climate-cryosphere-2026-08-22-v11-map-aligned',
	renderOnly: true,
	heightAuthorityUnchanged: true,
	mapAlignedCryosphere: true,
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
	MORAINE: new THREE.Color(0x6f7776),
	GLACIAL_ICE: new THREE.Color(0xdceaf0),
	SNOW: new THREE.Color(0xf4f6f7),
});

function latticeHash01(ix, iz) {
	const value = Math.sin(ix * 127.1 + iz * 311.7) * 43758.5453;
	return value - Math.floor(value);
}

function positionHash01(worldX, worldZ) {
	const cell = TERRAIN_BIOME_SHADING_POLICY.mottleCellMeters;
	const gx = worldX / cell;
	const gz = worldZ / cell;
	const x0 = Math.floor(gx);
	const z0 = Math.floor(gz);
	const fx = gx - x0;
	const fz = gz - z0;
	const sx = fx * fx * (3 - 2 * fx);
	const sz = fz * fz * (3 - 2 * fz);
	const h00 = latticeHash01(x0, z0);
	const h10 = latticeHash01(x0 + 1, z0);
	const h01 = latticeHash01(x0, z0 + 1);
	const h11 = latticeHash01(x0 + 1, z0 + 1);
	return lerp(lerp(h00, h10, sx), lerp(h01, h11, sx), sz);
}

export function normalizedMapYAtWorldZ(worldZ) {
	const bounds = WORLD_SCALE.MAP_BOUNDS;
	const centerMapY = (bounds.minY + bounds.maxY) * 0.5;
	const mapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	return clamp01(mapY / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits);
}

function permanentIceWeightAtNormalizedY(normalizedY) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	return 1 - smoothstep(P.northIceFullNormalizedY, P.northIceFadeNormalizedY, normalizedY);
}

function tundraWeightAtNormalizedY(normalizedY) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	return 1 - smoothstep(P.northIceFadeNormalizedY, P.northTundraFadeNormalizedY, normalizedY);
}

export function northClimateWeightsAtWorldZ(worldZ) {
	const normalizedY = normalizedMapYAtWorldZ(worldZ);
	return Object.freeze({
		normalizedY,
		permanentIce: permanentIceWeightAtNormalizedY(normalizedY),
		tundra: tundraWeightAtNormalizedY(normalizedY),
		mapAligned: false,
	});
}

export function northClimateWeightsAtWorldXZ(worldX, worldZ) {
	const climate = northReferenceCryosphereAtWorldXZ(worldX, worldZ);
	return Object.freeze({ ...climate, mapAligned: true });
}

function frozenShoreWeight(permanentIce, tundra) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	return clamp01(Math.max(
		permanentIce * P.northFrozenShoreIceStrength,
		tundra * P.northFrozenShoreTundraStrength,
	));
}

function coastalCryosphereProfile(permanentIce, tundra, out) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	const tundraBand = tundra * (1 - permanentIce);
	out.weight = clamp01(Math.max(
		permanentIce * P.northCoastalIceStrength,
		tundraBand * P.northCoastalIceTundraStrength,
	));
	out.topMeters = lerp(P.northCoastalIceTundraTopMeters, P.northCoastalIceTopMeters, permanentIce);
	out.fullMeters = lerp(P.northCoastalIceTundraFullMeters, P.northCoastalIceFullMeters, permanentIce);
	out.shallowDepthMeters = lerp(P.northShallowIceTundraDepthMeters, P.northShallowIceDepthMeters, permanentIce);
	out.shallowWeight = clamp01(Math.max(
		permanentIce * P.northShallowIceStrength,
		tundraBand * P.northShallowIceTundraStrength,
	));
	return out;
}

export function coastalCryosphereWeightAtWorldZ(worldZ) {
	const climate = northClimateWeightsAtWorldZ(worldZ);
	return coastalCryosphereProfile(climate.permanentIce, climate.tundra, {}).weight;
}

export function coastalCryosphereProfileAtWorldZ(worldZ) {
	const climate = northClimateWeightsAtWorldZ(worldZ);
	const profile = coastalCryosphereProfile(climate.permanentIce, climate.tundra, {});
	return Object.freeze({ ...climate, ...profile });
}

export function coastalCryosphereWeightAtWorldXZ(worldX, worldZ) {
	const climate = northClimateWeightsAtWorldXZ(worldX, worldZ);
	return coastalCryosphereProfile(climate.permanentIce, climate.tundra, {}).weight;
}

export function coastalCryosphereProfileAtWorldXZ(worldX, worldZ) {
	const climate = northClimateWeightsAtWorldXZ(worldX, worldZ);
	const profile = coastalCryosphereProfile(climate.permanentIce, climate.tundra, {});
	return Object.freeze({ ...climate, ...profile });
}

function snowlineRangeFromClimate(permanentIce, tundra, out) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	const tundraStart = lerp(P.snowAltitudeStartMeters, P.northTundraSnowlineStartMeters, tundra);
	const tundraFull = lerp(P.snowAltitudeFullMeters, P.northTundraSnowlineFullMeters, tundra);
	out.startMeters = lerp(tundraStart, P.northIceSnowlineStartMeters, permanentIce);
	out.fullMeters = lerp(tundraFull, P.northIceSnowlineFullMeters, permanentIce);
	return out;
}

export function mountainSnowlineAtWorldZ(worldZ) {
	const climate = northClimateWeightsAtWorldZ(worldZ);
	const range = snowlineRangeFromClimate(climate.permanentIce, climate.tundra, {});
	return Object.freeze({ ...climate, ...range });
}

export function mountainSnowlineAtWorldXZ(worldX, worldZ) {
	const climate = northClimateWeightsAtWorldXZ(worldX, worldZ);
	const range = snowlineRangeFromClimate(climate.permanentIce, climate.tundra, {});
	return Object.freeze({ ...climate, ...range });
}

export function terrainConcavityMetersFromNeighbours(center, heightWest, heightEast, heightNorth, heightSouth) {
	return (heightWest + heightEast + heightNorth + heightSouth) * 0.25 - center;
}

function computeTerrainSnowCoverage(out, {
	heightAboveSeaMeters,
	slopeDegrees,
	snowWeight,
	worldX = null,
	worldZ,
	terrainConcavityMeters = 0,
	terrainWindward = 0,
	terrainLee = 0,
}) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	const climate = Number.isFinite(worldX)
		? northReferenceCryosphereAtWorldXZ(worldX, worldZ)
		: northClimateWeightsAtWorldZ(worldZ);
	const normalizedY = climate.normalizedY ?? normalizedMapYAtWorldZ(worldZ);
	const permanentIce = climate.permanentIce;
	const tundra = climate.tundra;
	const snowline = snowlineRangeFromClimate(permanentIce, tundra, out);
	const altitudeSnow = smoothstep(snowline.startMeters, snowline.fullMeters, heightAboveSeaMeters);
	const canonicalSnow = clamp01(snowWeight) * P.canonicalSnowGain;
	const authoredSnow = Math.max(altitudeSnow, canonicalSnow);
	const northSnowSupply = permanentIce * P.northSnowMinimumCoverage;
	const tundraLowlandFloor = tundra * P.northTundraLowlandSnowFloor;
	const gentleSlope = 1 - smoothstep(P.snowDriftSlopeFullDegrees, P.snowDriftSlopeFadeDegrees, slopeDegrees);
	const driftSupply = gentleSlope * Math.max(
		permanentIce * P.northSnowDriftGain,
		tundra * (1 - permanentIce) * P.tundraSnowDriftGain,
	);
	const concavityHold = smoothstep(0, P.snowConcavityFullMeters, Math.max(0, terrainConcavityMeters));
	const ridgeExposure = smoothstep(0, P.snowConvexityFullMeters, Math.max(0, -terrainConcavityMeters));
	const terrainFormSupply = gentleSlope * concavityHold * Math.max(
		permanentIce * P.northConcavitySnowGain,
		tundra * (1 - permanentIce) * P.tundraConcavitySnowGain,
	);
	const ridgeScour = ridgeExposure * Math.max(
		permanentIce * P.northRidgeScourMax,
		tundra * (1 - permanentIce) * P.tundraRidgeScourMax,
	);
	const windSnow = resolveTerrainWindSnowAdjustment({
		windward: terrainWindward,
		lee: terrainLee,
		permanentIce,
		tundra,
	});
	const baseSnowSupply = Math.max(authoredSnow, northSnowSupply, tundraLowlandFloor)
		+ driftSupply + terrainFormSupply;
	const snowSupply = clamp01(baseSnowSupply + windSnow.leeDeposit - windSnow.windwardScour);
	const naturalHold = 1 - smoothstep(P.snowShedStartDegrees, P.snowShedFullDegrees, slopeDegrees);
	const climateHold = lerp(naturalHold, Math.max(naturalHold, 0.96), permanentIce);
	const snowHold = clamp01(climateHold * (1 - ridgeScour));
	const landEmergence = smoothstep(0, P.shoreEmergenceFullMeters, heightAboveSeaMeters);
	const snowAmount = clamp01(snowSupply * snowHold) * landEmergence;
	const lowlandIce = 1 - smoothstep(
		P.northIceLowlandTintFadeStartMeters,
		P.northIceLowlandTintFadeFullMeters,
		heightAboveSeaMeters,
	);
	const moraineExposure = permanentIce
		* smoothstep(P.northMoraineSlopeStartDegrees, P.northMoraineSlopeFullDegrees, slopeDegrees)
		* P.northMoraineMaxStrength
		* (1 - snowAmount);

	out.normalizedY = normalizedY;
	out.permanentIce = permanentIce;
	out.tundra = tundra;
	out.tundraBand = tundra * (1 - permanentIce);
	out.mapAlignedClimate = Number.isFinite(worldX);
	out.altitudeSnow = altitudeSnow;
	out.canonicalSnow = canonicalSnow;
	out.authoredSnow = authoredSnow;
	out.northSnowSupply = northSnowSupply;
	out.tundraLowlandFloor = tundraLowlandFloor;
	out.gentleSlope = gentleSlope;
	out.driftSupply = driftSupply;
	out.terrainConcavityMeters = terrainConcavityMeters;
	out.concavityHold = concavityHold;
	out.ridgeExposure = ridgeExposure;
	out.terrainFormSupply = terrainFormSupply;
	out.ridgeScour = ridgeScour;
	out.terrainWindward = terrainWindward;
	out.terrainLee = terrainLee;
	out.windwardScour = windSnow.windwardScour;
	out.leeDeposit = windSnow.leeDeposit;
	out.baseSnowSupply = baseSnowSupply;
	out.snowSupply = snowSupply;
	out.snowHold = snowHold;
	out.landEmergence = landEmergence;
	out.snowAmount = snowAmount;
	out.glacialIceTint = permanentIce * lowlandIce * P.northIceLowlandTintStrength * landEmergence;
	out.moraineExposure = moraineExposure;
	return out;
}

export function resolveTerrainSnowCoverage({
	heightAboveSeaMeters,
	slopeDegrees,
	snowWeight = 0,
	worldX = null,
	worldZ = 0,
	terrainConcavityMeters = 0,
	terrainWindward = 0,
	terrainLee = 0,
}) {
	return Object.freeze({ ...computeTerrainSnowCoverage({}, {
		heightAboveSeaMeters,
		slopeDegrees,
		snowWeight,
		worldX,
		worldZ,
		terrainConcavityMeters,
		terrainWindward,
		terrainLee,
	}) });
}

const scratchRock = new THREE.Color();
const scratchGround = new THREE.Color();
const scratchShore = new THREE.Color();
const scratchSeabed = new THREE.Color();
const scratchSnowCoverage = {};
const scratchCoastalCryosphere = {};

export function resolveTerrainBiomeColor(target, {
	heightAboveSeaMeters,
	slopeDegrees,
	rockWeight = 0,
	snowWeight = 0,
	worldX = 0,
	worldZ = 0,
	terrainConcavityMeters = 0,
	terrainWindward = 0,
	terrainLee = 0,
}) {
	const P = TERRAIN_BIOME_SHADING_POLICY;
	const height = heightAboveSeaMeters;
	const slope = slopeDegrees;
	const northClimate = northReferenceCryosphereAtWorldXZ(worldX, worldZ);
	const permanentNorth = northClimate.permanentIce;
	const tundraNorth = northClimate.tundra;
	const coldShore = frozenShoreWeight(permanentNorth, tundraNorth);
	const coastalCryosphere = coastalCryosphereProfile(permanentNorth, tundraNorth, scratchCoastalCryosphere);
	const landEmergence = smoothstep(0, P.shoreEmergenceFullMeters, height);

	const drift = signedFbmNoise(worldX * P.grassVariationFrequency + 5.3, worldZ * P.grassVariationFrequency - 2.9, 3);
	const meadowAmount = clamp01(0.45 + drift * 0.35);
	scratchGround.copy(TERRAIN_BIOME_PALETTE.GRASS_LOW).lerp(TERRAIN_BIOME_PALETTE.MEADOW, meadowAmount);
	target.copy(scratchGround)
		.lerp(TERRAIN_BIOME_PALETTE.GRASS_MID, smoothstep(P.grassMidStartMeters, P.grassMidFullMeters, height))
		.lerp(TERRAIN_BIOME_PALETTE.HEATH, clamp01(smoothstep(35, 115, height) + Math.max(0, -drift) * 0.22))
		.lerp(TERRAIN_BIOME_PALETTE.DRY_UPLAND, smoothstep(P.dryUplandStartMeters, P.dryUplandFullMeters, height));
	if (tundraNorth > 0) target.lerp(TERRAIN_BIOME_PALETTE.TUNDRA, tundraNorth * 0.78);

	const forestNoise01 = signedFbmNoise(worldX * P.forestPatchFrequency - 13.1, worldZ * P.forestPatchFrequency + 7.4, P.forestPatchOctaves) * 0.5 + 0.5;
	const forestPatch = smoothstep(P.forestPatchStart, P.forestPatchFull, forestNoise01);
	const notCliff = 1 - smoothstep(P.forestSlopeFalloffStartDegrees, P.forestSlopeFalloffFullDegrees, slope);
	const belowTreeLine = 1 - smoothstep(P.forestTreeLineStartMeters, P.forestTreeLineFullMeters, height);
	const forestAmount = forestPatch * notCliff * belowTreeLine * P.forestMaxStrength * (1 - permanentNorth) * (1 - tundraNorth * 0.62);
	if (forestAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.FOREST, forestAmount);

	const shoreAmount = (1 - smoothstep(P.shoreSandFullMeters, P.shoreSandTopMeters, height))
		* (1 - smoothstep(P.rockSlopeStartDegrees, P.rockSlopeFullDegrees, slope))
		* landEmergence;
	const sandAmount = shoreAmount * (1 - coldShore);
	if (sandAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.SHORE_SAND, sandAmount);
	if (shoreAmount > 0 && coldShore > 0) {
		scratchShore.copy(TERRAIN_BIOME_PALETTE.FROZEN_SHORE)
			.lerp(TERRAIN_BIOME_PALETTE.GLACIAL_SHORE, permanentNorth);
		target.lerp(scratchShore, shoreAmount * coldShore);
	}
	const coastalIceBand = (1 - smoothstep(coastalCryosphere.fullMeters, coastalCryosphere.topMeters, height))
		* landEmergence * coastalCryosphere.weight
		* (1 - smoothstep(18, 34, slope));
	if (coastalIceBand > 0) target.lerp(TERRAIN_BIOME_PALETTE.COASTAL_ICE, coastalIceBand);

	const rockAmount = clamp01(Math.max(
		smoothstep(P.rockSlopeStartDegrees, P.rockSlopeFullDegrees, slope),
		clamp01(rockWeight) * P.canonicalRockGain,
	));
	if (rockAmount > 0) {
		scratchRock.copy(TERRAIN_BIOME_PALETTE.ROCK_WARM)
			.lerp(TERRAIN_BIOME_PALETTE.ROCK_COOL, smoothstep(P.rockCoolStartMeters, P.rockCoolFullMeters, height));
		target.lerp(scratchRock, rockAmount);
	}

	const snow = computeTerrainSnowCoverage(scratchSnowCoverage, {
		heightAboveSeaMeters: height,
		slopeDegrees: slope,
		snowWeight,
		worldX,
		worldZ,
		terrainConcavityMeters,
		terrainWindward,
		terrainLee,
	});
	if (snow.moraineExposure > 0) target.lerp(TERRAIN_BIOME_PALETTE.MORAINE, snow.moraineExposure);
	if (snow.snowAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.SNOW, snow.snowAmount);
	if (snow.glacialIceTint > 0) target.lerp(TERRAIN_BIOME_PALETTE.GLACIAL_ICE, snow.glacialIceTint);

	const submergedAmount = 1 - smoothstep(-P.seabedFullDepthMeters, 0, height);
	if (submergedAmount > 0) {
		scratchSeabed.copy(TERRAIN_BIOME_PALETTE.SEABED)
			.lerp(TERRAIN_BIOME_PALETTE.NORTH_SEABED, coldShore * P.northFrozenSeabedStrength);
		target.lerp(scratchSeabed, submergedAmount);
	}
	if (height < 0 && coastalCryosphere.shallowWeight > 0) {
		const glacialShallowAmount = smoothstep(-coastalCryosphere.shallowDepthMeters, 0, height)
			* coastalCryosphere.shallowWeight;
		if (glacialShallowAmount > 0) target.lerp(TERRAIN_BIOME_PALETTE.GLACIAL_SHALLOW, glacialShallowAmount);
	}

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
