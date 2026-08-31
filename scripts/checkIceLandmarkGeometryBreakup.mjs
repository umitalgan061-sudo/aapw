#!/usr/bin/env node
import assert from 'node:assert/strict';

import { WORLD_DEFAULTS } from '../src/3d/config.js';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import { createIceLandmarks, disposeIceLandmarks } from '../src/3d/world/iceLandmarks.js';

const sampleHeightMeters = createHeightSampler(WORLD_DEFAULTS.WORLD_SEED);

function createSnapshot() {
	const result = createIceLandmarks({
		sampleHeightMeters,
		seed: WORLD_DEFAULTS.WORLD_SEED,
	});
	const breakup = result?.stats?.realism?.geometryBreakup;
	assert(breakup, 'ice geometry breakup telemetry is missing from shipped landmark creation');
	assert.equal(breakup.primaryMeshesFractured, true,
		'primary Wall and cave shell geometry must both receive deterministic fracture displacement');
	assert.equal(breakup.secondaryBreakupPresent, true,
		'secondary glacial breakup must remain visibly populated');
	assert(breakup.wallVertexMoves > 300, `Wall fracture vertex movement became sparse: ${breakup.wallVertexMoves}`);
	assert(breakup.caveVertexMoves > 200, `cave fracture vertex movement became sparse: ${breakup.caveVertexMoves}`);
	assert(breakup.macroFracturePlateCount > 8,
		`embedded Wall fracture plates disappeared: ${breakup.macroFracturePlateCount}`);
	assert(breakup.wallFlowRibCount > 8,
		`embedded Wall flow ribs disappeared: ${breakup.wallFlowRibCount}`);
	assert(breakup.portalShroudCount > 10,
		`portal-integrated fracture shroud disappeared: ${breakup.portalShroudCount}`);
	assert(breakup.caveFloorTriangleCount > 20,
		`cave floor sediment/wet ribbon topology collapsed: ${breakup.caveFloorTriangleCount}`);
	assert(breakup.caveSubsurfaceLightCount >= 3,
		`cave subsurface light breakup disappeared: ${breakup.caveSubsurfaceLightCount}`);
	assert(breakup.caveIcicleCount > 4,
		`secondary cave icicles disappeared: ${breakup.caveIcicleCount}`);
	assert(breakup.caveDebrisCount > 0,
		`cave sediment debris disappeared: ${breakup.caveDebrisCount}`);
	assert(breakup.caveBlueCoreCount > 4,
		`dense blue cave ice exposure disappeared: ${breakup.caveBlueCoreCount}`);

	const wall = result.group.getObjectByName('the-wall-natural-ice-cliff');
	const cave = result.group.getObjectByName('ice-cave-shell');
	assert.equal(wall?.userData?.primaryGlacialBreakup, true,
		'primary Wall mesh lost geometry-breakup marker');
	assert.equal(cave?.userData?.primaryGlacialBreakup, true,
		'primary cave shell lost geometry-breakup marker');
	assert.equal(wall?.userData?.worldSpaceGlacialAlbedoFabric,
		'deterministic-smoothed-multiscale-v5-neutral-ice');
	assert.equal(wall?.userData?.worldSpaceGlacialRoughnessFabric,
		'deterministic-shader-multiscale-v3-aerial');
	assert.equal(cave?.userData?.worldSpaceGlacialAlbedoFabric,
		'deterministic-smoothed-multiscale-v5-neutral-ice');

	const expected = [
		['ice-wall-macro-fracture-plates', 'wall-macro-fracture-plates', 'embedded-irregular-glacial-slab-v13'],
		['ice-wall-vertical-flow-ribs', 'wall-vertical-flow-ribs', 'embedded-tapered-glacial-flow-rib-v13'],
		['ice-cave-natural-portal-shroud', 'natural-fractured-portal-shroud', null],
		['ice-cave-sediment-floor', 'cave-sediment-floor', null],
		['ice-cave-dense-blue-core-slabs', 'cave-dense-blue-core-slabs', null],
	];
	for (const [name, role, geometryTag] of expected) {
		const object = result.group.getObjectByName(name);
		assert(object, `${name} shipped breakup object is missing`);
		assert.equal(object.userData?.iceLandmarkRole, role, `${name} role drifted`);
		if (geometryTag) assert.equal(object.userData?.breakupGeometry, geometryTag, `${name} geometry family drifted`);
		if (object.isInstancedMesh) assert(object.count > 0, `${name} contains no instances`);
	}

	const snapshot = JSON.parse(JSON.stringify(breakup));
	disposeIceLandmarks(result.group);
	return snapshot;
}

const first = createSnapshot();
const second = createSnapshot();
assert.deepEqual(second, first, 'ice geometry breakup telemetry lost same-seed determinism');

console.log('[checkIceLandmarkGeometryBreakup] PASS', JSON.stringify(first));
