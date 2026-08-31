#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import {
	TERRAIN_BIOME_SHADING_POLICY,
	mountainSnowlineAtWorldXZ,
	resolveTerrainSnowCoverage,
} from '../src/3d/world/terrainBiomeShading.js';

function worldAt(normalizedX, normalizedY) {
	return normalizedReferenceToWorldXZ(
		normalizedX,
		normalizedY,
		WORLD_SCALE.MAP_BOUNDS,
		WORLD_SCALE.METERS_PER_MAP_UNIT,
	);
}

function coverage(normalizedX, normalizedY, heightAboveSeaMeters) {
	const world = worldAt(normalizedX, normalizedY);
	return resolveTerrainSnowCoverage({
		heightAboveSeaMeters,
		slopeDegrees: 4,
		snowWeight: 0,
		worldX: world.x,
		worldZ: world.z,
	});
}

function snowline(normalizedX, normalizedY) {
	const world = worldAt(normalizedX, normalizedY);
	return mountainSnowlineAtWorldXZ(world.x, world.z);
}

const P = TERRAIN_BIOME_SHADING_POLICY;
const pathX = 0.16;
const startY = 0.115;
const endY = 0.48;
const samples = 520;
let previousLowland = null;
let previousSnowline = null;
let maxLowlandStep = 0;
let maxSnowlineStartStep = 0;
let sawIceTransition = false;
let sawTundraOnly = false;

for (let i = 0; i <= samples; i += 1) {
	const normalizedY = startY + (endY - startY) * (i / samples);
	const lowland = coverage(pathX, normalizedY, 18);
	const currentSnowline = snowline(pathX, normalizedY);

	assert(lowland.mapAlignedClimate,
		'map-aligned snow continuity sweep must exercise the X+Z cryosphere authority');
	assert(lowland.snowAmount >= 0 && lowland.snowAmount <= 1,
		'lowland snow coverage must stay normalized');
	assert(Number.isFinite(currentSnowline.startMeters) && Number.isFinite(currentSnowline.fullMeters),
		'mountain snowline must stay finite throughout the canonical north transition');
	if (lowland.permanentIce > 0 && lowland.permanentIce < 1) sawIceTransition = true;
	if (lowland.permanentIce === 0 && lowland.tundra > 0) sawTundraOnly = true;

	if (previousLowland) {
		maxLowlandStep = Math.max(maxLowlandStep, Math.abs(lowland.snowAmount - previousLowland.snowAmount));
	}
	if (previousSnowline) {
		maxSnowlineStartStep = Math.max(
			maxSnowlineStartStep,
			Math.abs(currentSnowline.startMeters - previousSnowline.startMeters),
		);
	}

	previousLowland = lowland;
	previousSnowline = currentSnowline;
}

assert(sawIceTransition, 'continuity sweep must cross partial permanent ice');
assert(sawTundraOnly, 'continuity sweep must cross tundra after permanent ice has faded');
assert(maxLowlandStep < 0.02,
	`map-aligned north snow must not form a visible geographic seam; maximum adjacent step was ${maxLowlandStep}`);
assert(maxSnowlineStartStep < 4,
	`map-aligned mountain snowline must move smoothly; maximum adjacent start shift was ${maxSnowlineStartStep} m`);

const farNorth = coverage(0.145, 0.115, 18);
const northTundra = coverage(0.175, 0.30, 18);
const south = coverage(0.185, 0.50, 18);
const sameLatitudeEast = coverage(0.72, 0.115, 18);
const farNorthSnowline = snowline(0.145, 0.115);
const northSnowline = snowline(0.175, 0.30);
const southSnowline = snowline(0.185, 0.50);
const eastSnowline = snowline(0.72, 0.115);

assert(farNorth.snowAmount > 0.9,
	'always-winter lowland must remain overwhelmingly frozen');
assert(northTundra.snowAmount > south.snowAmount,
	'canonical North tundra must retain more lowland snow than temperate south');
assert.equal(south.snowAmount, 0,
	'temperate south lowland without canonical snow must have no north snow floor');
assert.equal(sameLatitudeEast.permanentIce, 0,
	'same-latitude east must not inherit Westeros permanent ice');
assert.equal(sameLatitudeEast.snowAmount, 0,
	'same-latitude east lowland must not inherit Westeros snow cover');
assert(farNorthSnowline.startMeters < northSnowline.startMeters,
	'always-winter snowline must sit below canonical North tundra');
assert(northSnowline.startMeters < southSnowline.startMeters,
	'canonical North tundra snowline must sit below temperate south');
assert(eastSnowline.startMeters >= P.snowAltitudeStartMeters - 1e-9,
	'same-latitude east must recover the temperate mountain snowline');

console.log('[checkNorthSnowCoverageContinuity] PASS', JSON.stringify({
	policy: P.id,
	samples: samples + 1,
	maxLowlandStep,
	maxSnowlineStartStep,
	farNorthSnow: farNorth.snowAmount,
	northTundraSnow: northTundra.snowAmount,
	southSnow: south.snowAmount,
	sameLatitudeEastSnow: sameLatitudeEast.snowAmount,
	farNorthSnowlineStart: farNorthSnowline.startMeters,
	northSnowlineStart: northSnowline.startMeters,
	southSnowlineStart: southSnowline.startMeters,
	eastSnowlineStart: eastSnowline.startMeters,
}));
