#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import {
	mountainSnowlineAtWorldZ,
	resolveTerrainSnowCoverage,
	slopeDegreesFromNeighbours,
} from '../src/3d/world/terrainBiomeShading.js';

const MAP_WIDTH = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
const MAP_HEIGHT = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
const SEA_LEVEL = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const SLOPE_SPACING_METERS = 24;

function worldXForNormalizedMapX(normalizedX) {
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	return (normalizedX * MAP_WIDTH - centerMapX) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function worldZForNormalizedMapY(normalizedY) {
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	return (normalizedY * MAP_HEIGHT - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function makeAccumulator(id) {
	return {
		id,
		points: 0,
		land: 0,
		snowSum: 0,
		snowlineStartSum: 0,
		snowlineFullSum: 0,
		minLandSnow: Infinity,
		maxLandSnow: 0,
		lowlandUnwrittenSnowSamples: 0,
		lowlandUnwrittenSnowMax: 0,
		canonicalSnowSamples: 0,
	};
}

const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);
const bands = [
	{ id: 'permanent-ice', ys: [0.05, 0.08, 0.11] },
	{ id: 'tundra', ys: [0.31, 0.34, 0.37] },
	{ id: 'temperate', ys: [0.52, 0.60, 0.68] },
];

const results = new Map(bands.map((band) => [band.id, makeAccumulator(band.id)]));

for (const band of bands) {
	const stats = results.get(band.id);
	for (const normalizedY of band.ys) {
		const worldZ = worldZForNormalizedMapY(normalizedY);
		const snowline = mountainSnowlineAtWorldZ(worldZ);
		for (let xi = 0; xi <= 44; xi += 1) {
			const normalizedX = 0.03 + 0.94 * (xi / 44);
			const worldX = worldXForNormalizedMapX(normalizedX);
			const surface = { rockWeight: 0, snowWeight: 0, waterWeight: 0 };
			const center = sampleHeightMeters(worldX, worldZ, undefined, surface);
			const west = sampleHeightMeters(worldX - SLOPE_SPACING_METERS, worldZ);
			const east = sampleHeightMeters(worldX + SLOPE_SPACING_METERS, worldZ);
			const north = sampleHeightMeters(worldX, worldZ - SLOPE_SPACING_METERS);
			const south = sampleHeightMeters(worldX, worldZ + SLOPE_SPACING_METERS);
			const slopeDegrees = slopeDegreesFromNeighbours(west, east, north, south, SLOPE_SPACING_METERS);
			const heightAboveSeaMeters = center - SEA_LEVEL;
			const coverage = resolveTerrainSnowCoverage({
				heightAboveSeaMeters,
				slopeDegrees,
				snowWeight: surface.snowWeight,
				worldZ,
			});

			stats.points += 1;
			stats.snowlineStartSum += snowline.startMeters;
			stats.snowlineFullSum += snowline.fullMeters;
			assert(Number.isFinite(center) && Number.isFinite(slopeDegrees), 'canonical runtime terrain sample must stay finite');
			assert(Number.isFinite(surface.snowWeight) && surface.snowWeight >= 0 && surface.snowWeight <= 1,
				'canonical Pindex snowWeight must remain normalized');
			assert(Math.abs(coverage.canonicalSnow - surface.snowWeight) < 1e-12,
				'render snow contract must consume the exact canonical map snowWeight without remapping it');
			assert(coverage.snowAmount >= 0 && coverage.snowAmount <= 1, 'runtime snow coverage must remain normalized');

			if (heightAboveSeaMeters <= 0.35) continue;
			stats.land += 1;
			stats.snowSum += coverage.snowAmount;
			stats.minLandSnow = Math.min(stats.minLandSnow, coverage.snowAmount);
			stats.maxLandSnow = Math.max(stats.maxLandSnow, coverage.snowAmount);
			if (surface.snowWeight >= 0.50) stats.canonicalSnowSamples += 1;

			if (
				band.id === 'tundra'
				&& heightAboveSeaMeters < 100
				&& surface.snowWeight < 0.10
			) {
				stats.lowlandUnwrittenSnowSamples += 1;
				stats.lowlandUnwrittenSnowMax = Math.max(stats.lowlandUnwrittenSnowMax, coverage.snowAmount);
			}
		}
	}
}

const ice = results.get('permanent-ice');
const tundra = results.get('tundra');
const temperate = results.get('temperate');
for (const stats of [ice, tundra, temperate]) {
	assert(stats.points > 100, `${stats.id} fixture must sample the canonical owner map densely`);
	assert(stats.land >= 5, `${stats.id} fixture must encounter enough canonical land for a meaningful runtime check`);
	stats.meanSnow = stats.snowSum / stats.land;
	stats.meanSnowlineStart = stats.snowlineStartSum / stats.points;
	stats.meanSnowlineFull = stats.snowlineFullSum / stats.points;
}

assert(ice.meanSnowlineStart < tundra.meanSnowlineStart,
	'actual far-north map band must have a lower mean snowline than tundra');
assert(tundra.meanSnowlineStart < temperate.meanSnowlineStart,
	'actual tundra map band must have a lower mean snowline than temperate Westeros');
assert(ice.meanSnowlineFull < tundra.meanSnowlineFull && tundra.meanSnowlineFull < temperate.meanSnowlineFull,
	'full-snow altitude must rise in the same north-to-south order');
assert(ice.minLandSnow > 0.88,
	`every sampled permanent-ice land point must stay snow/ice covered; minimum was ${ice.minLandSnow}`);
assert(ice.meanSnow > 0.90,
	`canonical far-north land must read overwhelmingly frozen; mean coverage was ${ice.meanSnow}`);
assert(tundra.lowlandUnwrittenSnowSamples >= 1,
	'canonical tundra fixture must include at least one low, non-authored-snow land point');
assert(tundra.lowlandUnwrittenSnowMax <= 0.20,
	`unwritten tundra lowland must remain patchy rather than white-sheet snow; max was ${tundra.lowlandUnwrittenSnowMax}`);

console.log('[checkNorthMountainSnowlineRuntime] PASS', JSON.stringify({
	bands: Object.fromEntries([...results.entries()].map(([id, stats]) => [id, {
		land: stats.land,
		meanSnow: Number(stats.meanSnow.toFixed(4)),
		minLandSnow: Number(stats.minLandSnow.toFixed(4)),
		maxLandSnow: Number(stats.maxLandSnow.toFixed(4)),
		meanSnowlineStart: Number(stats.meanSnowlineStart.toFixed(2)),
		meanSnowlineFull: Number(stats.meanSnowlineFull.toFixed(2)),
		lowlandUnwrittenSnowSamples: stats.lowlandUnwrittenSnowSamples,
		canonicalSnowSamples: stats.canonicalSnowSamples,
	}]))
}));
