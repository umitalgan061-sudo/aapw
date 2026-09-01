#!/usr/bin/env node
import assert from 'node:assert/strict';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import { REFERENCE_BIOME_ZONES } from '../src/3d/world/worldReferenceMap.js';
import {
	WIND_GRASS_DRY_BIOME_POLICY,
	windGrassDryBiomeProfileAtWorldXZ,
} from '../src/3d/world/windGrassBiomeClimate.js';

function zoneById(id) {
	const zone = REFERENCE_BIOME_ZONES.find((entry) => entry.id === id);
	assert(zone, `missing canonical reference zone ${id}`);
	return zone;
}

function worldAt(normalizedX, normalizedY) {
	return normalizedReferenceToWorldXZ(
		normalizedX,
		normalizedY,
		WORLD_SCALE.MAP_BOUNDS,
		WORLD_SCALE.METERS_PER_MAP_UNIT,
	);
}

function profileAt(normalizedX, normalizedY) {
	const world = worldAt(normalizedX, normalizedY);
	return windGrassDryBiomeProfileAtWorldXZ(world.x, world.z);
}

for (const id of ['dorne', 'red-waste', 'grey-waste']) {
	const zone = zoneById(id);
	const profile = profileAt(zone.center[0], zone.center[1]);
	assert.equal(profile.zoneId, id, `${id} center must resolve to its canonical dry zone`);
	assert(profile.influence > WIND_GRASS_DRY_BIOME_POLICY.zeroDensityInfluence,
		`${id} center must exceed ordinary-grass zero-density influence`);
	assert.equal(profile.densityMultiplier, 0, `${id} center must carry no ordinary green wind grass`);
	assert.equal(profile.heightMultiplier, WIND_GRASS_DRY_BIOME_POLICY.minimumHeightScale,
		`${id} center height modifier must remain bounded`);
}

for (const id of ['reach', 'yi-ti', 'north']) {
	const zone = zoneById(id);
	const profile = profileAt(zone.center[0], zone.center[1]);
	assert.equal(profile.influence, 0, `${id} center must not inherit desert/arid ownership`);
	assert.equal(profile.densityMultiplier, 1, `${id} ordinary grass density must remain unchanged`);
	assert.equal(profile.heightMultiplier, 1, `${id} ordinary grass height must remain unchanged`);
}

const dorne = zoneById('dorne');
const center = profileAt(dorne.center[0], dorne.center[1]);
const fringe = profileAt(dorne.center[0] + dorne.radius[0] * 0.62, dorne.center[1]);
const outside = profileAt(dorne.center[0] + dorne.radius[0] * 1.08, dorne.center[1]);
assert(center.densityMultiplier < fringe.densityMultiplier,
	'Dorne dry-core to fringe must restore ordinary grass monotonically');
assert(fringe.densityMultiplier < outside.densityMultiplier,
	'Dorne fringe to outside must restore ordinary grass monotonically');
assert.equal(outside.densityMultiplier, 1, 'outside dry-biome influence ordinary grass must fully recover');

const repeated = profileAt(dorne.center[0] + dorne.radius[0] * 0.62, dorne.center[1]);
assert.deepEqual(repeated, fringe, 'dry-biome wind-grass profile must be deterministic');

console.log('[checkWindGrassDryBiomeDistribution] PASS', JSON.stringify({
	policyId: WIND_GRASS_DRY_BIOME_POLICY.id,
	dorneCenterDensity: center.densityMultiplier,
	dorneFringeDensity: Number(fringe.densityMultiplier.toFixed(4)),
	dorneOutsideDensity: outside.densityMultiplier,
}));
