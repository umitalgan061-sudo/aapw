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

function canonicalNorthXAt(normalizedY) {
	const winter = { x: 0.145, y: 0.115 };
	const north = { x: 0.175, y: 0.285 };
	const south = { x: 0.22, y: 0.52 };
	if (normalizedY <= winter.y) return winter.x;
	if (normalizedY <= north.y) {
		const t = (normalizedY - winter.y) / (north.y - winter.y);
		return winter.x + (north.x - winter.x) * t;
	}
	const t = Math.min(1, (normalizedY - north.y) / (south.y - north.y));
	return north.x + (south.x - north.x) * t;
}

function snowlineAt(normalizedY, normalizedX = canonicalNorthXAt(normalizedY)) {
	const world = worldAt(normalizedX, normalizedY);
	return mountainSnowlineAtWorldXZ(world.x, world.z);
}

function coverageAt({ normalizedX = canonicalNorthXAt(normalizedY), normalizedY, height, slope = 8, snowWeight = 0 }) {
	const world = worldAt(normalizedX, normalizedY);
	return resolveTerrainSnowCoverage({
		heightAboveSeaMeters: height,
		slopeDegrees: slope,
		snowWeight,
		worldX: world.x,
		worldZ: world.z,
	});
}

const P = TERRAIN_BIOME_SHADING_POLICY;
const farNorth = snowlineAt(0.115, 0.145);
const iceTransition = snowlineAt(0.20, 0.155);
const tundra = snowlineAt(0.285, 0.175);
const temperate = snowlineAt(0.62, 0.52);
const sameLatitudeEast = snowlineAt(0.115, 0.72);

assert.equal(temperate.startMeters, P.snowAltitudeStartMeters,
	'temperate south must retain the measured snowline start');
assert.equal(temperate.fullMeters, P.snowAltitudeFullMeters,
	'temperate south must retain the measured full-snow altitude');
assert.equal(sameLatitudeEast.startMeters, P.snowAltitudeStartMeters,
	'same-latitude east must retain the temperate snowline outside Westeros cryosphere');
assert(tundra.startMeters < temperate.startMeters - 60,
	'canonical North tundra mountains must hold snow materially lower than temperate mountains');
assert(tundra.fullMeters < temperate.fullMeters - 60,
	'canonical North tundra mountains must reach full snow materially lower than temperate mountains');
assert(iceTransition.startMeters < tundra.startMeters,
	'the snowline must continue descending through the permanent-ice transition');
assert(farNorth.startMeters <= 1,
	'fully permanent ice must bring the snowline to essentially sea level');
assert(farNorth.fullMeters <= P.northIceSnowlineFullMeters + 1e-9,
	'far-north full snow must use the dedicated low cryosphere altitude');

// Follow the authored Westeros north path rather than a fixed longitude. The winter and North
// climate zones overlap, so global monotonicity between every adjacent sample is not a valid
// requirement; the canonical anchors above enforce the large-scale ordering while this sweep
// guards against visible local snowline seams.
const sweepStart = 0.115;
const sweepEnd = 0.52;
const sweepSamples = 400;
let previous = snowlineAt(sweepStart);
let maxStartStep = 0;
let maxFullStep = 0;
let maxSouthwardStartDrop = 0;
let maxSouthwardFullDrop = 0;
for (let i = 1; i <= sweepSamples; i += 1) {
	const normalizedY = sweepStart + (sweepEnd - sweepStart) * (i / sweepSamples);
	const current = snowlineAt(normalizedY);
	assert(current.fullMeters > current.startMeters,
		'every climate sample must retain a non-zero snow accumulation band');
	const startDelta = current.startMeters - previous.startMeters;
	const fullDelta = current.fullMeters - previous.fullMeters;
	maxStartStep = Math.max(maxStartStep, Math.abs(startDelta));
	maxFullStep = Math.max(maxFullStep, Math.abs(fullDelta));
	maxSouthwardStartDrop = Math.max(maxSouthwardStartDrop, -startDelta);
	maxSouthwardFullDrop = Math.max(maxSouthwardFullDrop, -fullDelta);
	previous = current;
}
assert(maxStartStep < 5 && maxFullStep < 5,
	`map-aligned snowline must remain continuous; observed steps ${maxStartStep.toFixed(3)} / ${maxFullStep.toFixed(3)} m`);

const southMountain = coverageAt({ normalizedX: 0.52, normalizedY: 0.62, height: 300 });
const tundraMountain = coverageAt({ normalizedX: 0.175, normalizedY: 0.285, height: 300 });
const iceLowland = coverageAt({ normalizedX: 0.145, normalizedY: 0.115, height: 18 });
const tundraLowland = coverageAt({ normalizedX: 0.175, normalizedY: 0.285, height: 18 });
const canonicalSouthSnow = coverageAt({ normalizedX: 0.52, normalizedY: 0.62, height: 18, snowWeight: 1 });
const steepIce = coverageAt({ normalizedX: 0.145, normalizedY: 0.115, height: 80, slope: 70 });
const flatIce = coverageAt({ normalizedX: 0.145, normalizedY: 0.115, height: 18, slope: 2 });
const highIce = coverageAt({ normalizedX: 0.145, normalizedY: 0.115, height: 320, slope: 2 });
const eastLowland = coverageAt({ normalizedX: 0.72, normalizedY: 0.115, height: 18 });

assert(southMountain.altitudeSnow < 0.05,
	'a 300 m temperate mountain must remain below the southern altitude snowline');
assert(tundraMountain.altitudeSnow > 0.25,
	'the same 300 m mountain in canonical North tundra must visibly accumulate altitude snow');
assert(iceLowland.snowAmount > 0.88,
	'low permanent-ice land must remain almost completely snow/ice covered');
assert(tundraLowland.tundraLowlandFloor > 0
	&& tundraLowland.tundraLowlandFloor <= P.northTundraLowlandSnowFloor + 1e-9,
	'canonical tundra lowland must retain only the authored patchy lowland floor');
assert(tundraLowland.driftSupply >= 0
	&& tundraLowland.driftSupply <= P.tundraSnowDriftGain + 1e-9,
	'gentle tundra terrain may add only the bounded natural snow-drift contribution');
assert(tundraLowland.snowAmount > 0
	&& tundraLowland.snowAmount <= P.northTundraLowlandSnowFloor + P.tundraSnowDriftGain + 1e-9,
	'low tundra floor plus gentle drift must remain patchy rather than becoming a second permanent ice sheet');
assert.equal(eastLowland.snowAmount, 0,
	'same-latitude east lowland must remain free of the Westeros snow floor');
assert(canonicalSouthSnow.snowAmount > 0.95,
	'canonical map snow must still override climate/altitude when explicitly authored');
assert(steepIce.snowAmount > 0.88,
	'permanent cryosphere must retain snow on steep terrain instead of exposing green cliffs');
assert(flatIce.glacialIceTint > 0.25,
	'low flat permanent ice must receive the blue-white glacial tint');
assert(highIce.glacialIceTint < 0.01,
	'high permanent-ice mountains must stay predominantly snow-white rather than blue ice');

for (const sample of [southMountain, tundraMountain, iceLowland, tundraLowland, canonicalSouthSnow, steepIce, eastLowland]) {
	for (const key of ['startMeters', 'fullMeters', 'altitudeSnow', 'canonicalSnow', 'snowAmount', 'snowHold', 'glacialIceTint']) {
		assert(Number.isFinite(sample[key]), `${key} must remain finite`);
	}
	assert(sample.snowAmount >= 0 && sample.snowAmount <= 1, 'snowAmount must remain normalized');
	assert(sample.glacialIceTint >= 0 && sample.glacialIceTint <= 1, 'glacialIceTint must remain normalized');
}

console.log('[checkNorthMountainSnowline] PASS', JSON.stringify({
	policy: P.id,
	farNorth: { start: farNorth.startMeters, full: farNorth.fullMeters },
	iceTransition: { start: iceTransition.startMeters, full: iceTransition.fullMeters },
	tundra: { start: tundra.startMeters, full: tundra.fullMeters },
	temperate: { start: temperate.startMeters, full: temperate.fullMeters },
	sameLatitudeEast: { start: sameLatitudeEast.startMeters, full: sameLatitudeEast.fullMeters },
	southMountainSnow: southMountain.snowAmount,
	tundraMountainSnow: tundraMountain.snowAmount,
	tundraLowlandSnow: tundraLowland.snowAmount,
	tundraLowlandFloor: tundraLowland.tundraLowlandFloor,
	tundraLowlandDrift: tundraLowland.driftSupply,
	iceLowlandSnow: iceLowland.snowAmount,
	maxStartStep,
	maxFullStep,
	maxSouthwardStartDrop,
	maxSouthwardFullDrop,
	sweepStart,
	sweepEnd,
}));