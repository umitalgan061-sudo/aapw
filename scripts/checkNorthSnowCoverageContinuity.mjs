#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import { WORLD_REFERENCE_ALIGNMENT } from '../src/3d/world/worldReferenceAlignment.js';
import {
	TERRAIN_BIOME_SHADING_POLICY,
	mountainSnowlineAtWorldZ,
	resolveTerrainSnowCoverage,
} from '../src/3d/world/terrainBiomeShading.js';

function worldZForNormalizedMapY(normalizedY) {
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	return (normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits - centerMapY)
		* WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function coverage(normalizedY, heightAboveSeaMeters) {
	return resolveTerrainSnowCoverage({
		heightAboveSeaMeters,
		slopeDegrees: 4,
		snowWeight: 0,
		worldZ: worldZForNormalizedMapY(normalizedY),
	});
}

const P = TERRAIN_BIOME_SHADING_POLICY;
const startY = 0.04;
const endY = P.northTundraFadeNormalizedY + 0.04;
const samples = 480;
let previousLowland = null;
let previousSnowline = null;
let maxLowlandStep = 0;
let maxSnowlineStartStep = 0;
let sawIceTransition = false;
let sawTundraOnly = false;

for (let i = 0; i <= samples; i += 1) {
	const normalizedY = startY + (endY - startY) * (i / samples);
	const worldZ = worldZForNormalizedMapY(normalizedY);
	const lowland = coverage(normalizedY, 18);
	const snowline = mountainSnowlineAtWorldZ(worldZ);

	assert(lowland.snowAmount >= 0 && lowland.snowAmount <= 1, 'lowland snow coverage must stay normalized');
	assert(Number.isFinite(snowline.startMeters) && Number.isFinite(snowline.fullMeters),
		'mountain snowline must stay finite throughout the north transition');
	if (lowland.permanentIce > 0 && lowland.permanentIce < 1) sawIceTransition = true;
	if (lowland.permanentIce === 0 && lowland.tundra > 0) sawTundraOnly = true;

	if (previousLowland) {
		const lowlandStep = Math.abs(lowland.snowAmount - previousLowland.snowAmount);
		maxLowlandStep = Math.max(maxLowlandStep, lowlandStep);
		assert(lowland.snowAmount <= previousLowland.snowAmount + 1e-9,
			`unwritten lowland snow must fade monotonically southward; ${previousLowland.snowAmount} -> ${lowland.snowAmount} at y=${normalizedY}`);
	}
	if (previousSnowline) {
		const snowlineStep = snowline.startMeters - previousSnowline.startMeters;
		maxSnowlineStartStep = Math.max(maxSnowlineStartStep, Math.abs(snowlineStep));
		assert(snowlineStep >= -1e-9, 'mountain snowline must never descend while travelling south');
	}

	previousLowland = lowland;
	previousSnowline = snowline;
}

assert(sawIceTransition, 'continuity sweep must cross partial permanent ice');
assert(sawTundraOnly, 'continuity sweep must cross tundra after permanent ice has faded');
assert(maxLowlandStep < 0.02,
	`lowland north snow must not form a visible latitude seam; maximum adjacent step was ${maxLowlandStep}`);
assert(maxSnowlineStartStep < 4,
	`mountain snowline must move smoothly with latitude; maximum adjacent start shift was ${maxSnowlineStartStep} m`);

const farNorth = coverage(0.06, 18);
const iceEdge = coverage(P.northIceFadeNormalizedY, 18);
const tundraMiddle = coverage((P.northIceFadeNormalizedY + P.northTundraFadeNormalizedY) * 0.5, 18);
const south = coverage(P.northTundraFadeNormalizedY + 0.03, 18);
assert(farNorth.snowAmount > 0.9, 'far north lowland must remain overwhelmingly frozen');
assert(iceEdge.snowAmount >= tundraMiddle.snowAmount,
	'the end of permanent ice must not become less snowy than farther-south tundra');
assert(tundraMiddle.snowAmount > south.snowAmount,
	'tundra patch snow must fade to zero before temperate ground');
assert.equal(south.snowAmount, 0, 'temperate lowland without canonical snow must have no latitude snow floor');

console.log('[checkNorthSnowCoverageContinuity] PASS', JSON.stringify({
	policy: P.id,
	samples: samples + 1,
	maxLowlandStep,
	maxSnowlineStartStep,
	farNorthSnow: farNorth.snowAmount,
	iceEdgeSnow: iceEdge.snowAmount,
	tundraMiddleSnow: tundraMiddle.snowAmount,
}));
