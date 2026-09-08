#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { WORLD_SCALE } from '../src/3d/config.js';
import { normalizedReferenceToWorldXZ } from '../src/3d/world/worldReferenceAlignment.js';
import { REFERENCE_BIOME_ZONES } from '../src/3d/world/worldReferenceMap.js';
import {
	WIND_GRASS_DRY_BIOME_POLICY,
	windGrassDryBiomeProfileAtWorldXZ,
} from '../src/3d/world/windGrassBiomeClimate.js';
import {
	RUN180_WIND_GRASS_CONFIG,
	createWindGrassGeometry,
	populateWindGrass,
} from '../src/3d/world/windGrass.js';

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

function runtimeCellAtZone(id) {
	const zone = zoneById(id);
	const world = worldAt(zone.center[0], zone.center[1]);
	const geometry = createWindGrassGeometry();
	const material = new THREE.MeshStandardMaterial();
	const mesh = new THREE.InstancedMesh(geometry, material, RUN180_WIND_GRASS_CONFIG.mobile.maxPatches);
	const placed = populateWindGrass(mesh, {
		sampleHeightMeters: () => 110,
		seaLevelMeters: 0,
		seed: 0x44525947,
		seats: [],
		roadEdges: [],
		isMobileClass: true,
	}, Math.round(world.x / RUN180_WIND_GRASS_CONFIG.cellMeters), Math.round(world.z / RUN180_WIND_GRASS_CONFIG.cellMeters));
	const telemetry = { ...mesh.userData.northGroundCover };
	geometry.dispose();
	material.dispose();
	return { placed, telemetry };
}

const dorneRuntime = runtimeCellAtZone('dorne');
const braavosRuntime = runtimeCellAtZone('braavos-coast');
assert.equal(dorneRuntime.telemetry.mapAlignedDryBiome, true,
	'production wind-grass runtime must expose canonical dry-biome ownership');
assert.equal(dorneRuntime.telemetry.dryBiomePolicyId, WIND_GRASS_DRY_BIOME_POLICY.id,
	'production wind-grass runtime must expose the exact dry-biome policy');
assert(dorneRuntime.telemetry.dryBiomeCandidateCount > 0,
	'Dorne production cell must encounter canonical dry-biome candidates');
assert(dorneRuntime.telemetry.dryBiomeCoreRejected > 0,
	'Dorne production cell must reject ordinary grass inside its dry core');
assert.equal(braavosRuntime.telemetry.dryBiomeCandidateCount, 0,
	'Braavos temperate-coast production cell must not be misclassified as dry');
assert(braavosRuntime.placed > 0, 'temperate-coast production cell must retain ordinary wind grass');

console.log('[checkWindGrassDryBiomeDistribution] PASS', JSON.stringify({
	policyId: WIND_GRASS_DRY_BIOME_POLICY.id,
	dorneCenterDensity: center.densityMultiplier,
	dorneFringeDensity: Number(fringe.densityMultiplier.toFixed(4)),
	dorneOutsideDensity: outside.densityMultiplier,
	dorneRuntime,
	braavosRuntime,
}));
