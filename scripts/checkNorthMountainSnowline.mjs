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
	const mapY = normalizedY * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	return (mapY - centerMapY) * WORLD_SCALE.METERS_PER_MAP_UNIT;
}

function snowlineAt(normalizedY) {
	return mountainSnowlineAtWorldZ(worldZForNormalizedMapY(normalizedY));
}

function coverageAt({ normalizedY, height, slope = 8, snowWeight = 0 }) {
	return resolveTerrainSnowCoverage({
		heightAboveSeaMeters: height,
		slopeDegrees: slope,
		snowWeight,
		worldZ: worldZForNormalizedMapY(normalizedY),
	});
}

const P = TERRAIN_BIOME_SHADING_POLICY;
const farNorth = snowlineAt(0.06);
const iceTransition = snowlineAt(0.20);
const tundra = snowlineAt(0.34);
const temperate = snowlineAt(0.62);

assert.equal(temperate.startMeters, P.snowAltitudeStartMeters,
	'temperate south must retain the measured 380 m snowline start');
assert.equal(temperate.fullMeters, P.snowAltitudeFullMeters,
	'temperate south must retain the measured 580 m full-snow altitude');
assert(tundra.startMeters < temperate.startMeters - 60,
	'tundra mountains must start holding snow materially lower than temperate mountains');
assert(tundra.fullMeters < temperate.fullMeters - 60,
	'tundra mountains must reach full snow materially lower than temperate mountains');
assert(iceTransition.startMeters < tundra.startMeters,
	'the snowline must continue descending through the permanent-ice transition');
assert(farNorth.startMeters <= 1,
	'fully permanent ice must bring the snowline to essentially sea level');
assert(farNorth.fullMeters <= P.northIceSnowlineFullMeters + 1e-9,
	'far-north full snow must use the dedicated low cryosphere altitude');

let previous = snowlineAt(0.03);
let maxStartStep = 0;
let maxFullStep = 0;
for (let i = 1; i <= 500; i += 1) {
	const normalizedY = 0.03 + 0.47 * (i / 500);
	const current = snowlineAt(normalizedY);
	assert(current.startMeters >= previous.startMeters - 1e-9,
		'mountain snowline start must rise monotonically when travelling south');
	assert(current.fullMeters >= previous.fullMeters - 1e-9,
		'full-snow altitude must rise monotonically when travelling south');
	assert(current.fullMeters > current.startMeters,
		'every latitude must retain a non-zero snow accumulation band');
	maxStartStep = Math.max(maxStartStep, current.startMeters - previous.startMeters);
	maxFullStep = Math.max(maxFullStep, current.fullMeters - previous.fullMeters);
	previous = current;
}
assert(maxStartStep < 5 && maxFullStep < 5,
	`latitude snowline must remain continuous; observed steps ${maxStartStep.toFixed(3)} / ${maxFullStep.toFixed(3)} m`);

const southMountain = coverageAt({ normalizedY: 0.62, height: 300 });
const tundraMountain = coverageAt({ normalizedY: 0.31, height: 300 });
const iceLowland = coverageAt({ normalizedY: 0.06, height: 18 });
const tundraLowland = coverageAt({ normalizedY: 0.34, height: 18 });
const canonicalSouthSnow = coverageAt({ normalizedY: 0.62, height: 18, snowWeight: 1 });
const steepIce = coverageAt({ normalizedY: 0.06, height: 80, slope: 70 });
const flatIce = coverageAt({ normalizedY: 0.06, height: 18, slope: 2 });
const highIce = coverageAt({ normalizedY: 0.06, height: 320, slope: 2 });

assert(southMountain.altitudeSnow < 0.05,
	'a 300 m temperate mountain must remain below the southern altitude snowline');
assert(tundraMountain.altitudeSnow > 0.25,
	'the same 300 m mountain in the tundra core must visibly accumulate altitude snow');
assert(iceLowland.snowAmount > 0.88,
	'low permanent-ice land must remain almost completely snow/ice covered');
assert(tundraLowland.snowAmount > 0 && tundraLowland.snowAmount <= P.northTundraLowlandSnowFloor + 1e-9,
	'low tundra may retain patchy snow but must not become a second permanent ice sheet');
assert(canonicalSouthSnow.snowAmount > 0.95,
	'canonical map snow must still override latitude/altitude when explicitly authored');
assert(steepIce.snowAmount > 0.88,
	'permanent cryosphere must retain snow on steep terrain instead of exposing green cliffs');
assert(flatIce.glacialIceTint > 0.25,
	'low flat permanent ice must receive the blue-white glacial tint');
assert(highIce.glacialIceTint < 0.01,
	'high permanent-ice mountains must stay predominantly snow-white rather than blue ice');

for (const sample of [southMountain, tundraMountain, iceLowland, tundraLowland, canonicalSouthSnow, steepIce]) {
	for (const key of ['startMeters', 'fullMeters', 'altitudeSnow', 'canonicalSnow', 'snowAmount', 'snowHold', 'glacialIceTint']) {
		assert(Number.isFinite(sample[key]), `${key} must remain finite`);
	}
	assert(sample.snowAmount >= 0 && sample.snowAmount <= 1, 'snowAmount must remain normalized');
	assert(sample.glacialIceTint >= 0 && sample.glacialIceTint <= 1, 'glacialIceTint must remain normalized');
}

console.log('[checkNorthMountainSnowline] PASS', JSON.stringify({
	policy: P.id,
	farNorth: { start: farNorth.startMeters, full: farNorth.fullMeters },
	tundra: { start: tundra.startMeters, full: tundra.fullMeters },
	temperate: { start: temperate.startMeters, full: temperate.fullMeters },
	southMountainSnow: southMountain.snowAmount,
	tundraMountainSnow: tundraMountain.snowAmount,
	iceLowlandSnow: iceLowland.snowAmount,
	maxStartStep,
	maxFullStep,
}));
