#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHeightSampler } from '../src/3d/world/terrain.js';
import {
	createFoundationFlattenPad,
	createTerrainFoundationConformer,
	rebuildChunksForFoundation,
	rebuildChunksForFoundations,
	TERRAIN_FOUNDATION_CONFORM_POLICY,
} from '../src/3d/world/terrainFoundationConformer.js';

const payloadObject = { uuid: 'object-keep', userData: {} };
const payload = {
	metadata: { id: 'test-keep', category: 'building' },
	object: payloadObject,
	bounds: { minX: 92, maxX: 108, minZ: -56, maxZ: -44 },
	targetHeight: 71.25,
};

const built = createFoundationFlattenPad(payload, { innerMarginMeters: 1, featherMeters: 9 });
assert.equal(built.ok, true, built.error);
assert.equal(built.key, 'object:object-keep', 'runtime Object3D identity must outrank shared asset/catalog ids');
assert.equal(built.pad.x, 100);
assert.equal(built.pad.z, -50);
assert.equal(built.pad.anchorHeightMeters, 71.25);
assert.equal(built.pads.length, 4, 'non-degenerate AABB foundations should use four compact pads');
assert.equal(built.pad.foundationClusterSize, 4);
assert.equal(built.pad.outerRadiusMeters, built.pad.innerRadiusMeters + 9);
assert.equal(built.pad.source, TERRAIN_FOUNDATION_CONFORM_POLICY.id);
assert.equal(TERRAIN_FOUNDATION_CONFORM_POLICY.footprintMode, 'root-oriented-adaptive-four-cell-rectangle-union-with-aabb-fallback');
assert.equal(TERRAIN_FOUNDATION_CONFORM_POLICY.chunkRebuildMode, 'union-deduplicated');
assert.equal(TERRAIN_FOUNDATION_CONFORM_POLICY.identityMode, 'runtime-object-first');
for (const pad of built.pads) {
	assert.equal(pad.foundationKey, 'object:object-keep');
	assert.equal(pad.foundationClusterSize, 4);
	assert.equal(pad.anchorHeightMeters, 71.25);
}

const authoredOnly = createFoundationFlattenPad({
	metadata: { instanceId: 'authored-placement-7', id: 'shared-house-catalog-id' },
	bounds: payload.bounds,
	targetHeight: 70,
});
assert.equal(authoredOnly.ok, true, authoredOnly.error);
assert.equal(authoredOnly.key, 'asset:authored-placement-7',
	'non-Object3D authoring callers must retain a deterministic explicit placement identity fallback');

const invalid = createFoundationFlattenPad({ bounds: payload.bounds, targetHeight: Number.NaN });
assert.equal(invalid.ok, false);
assert.equal(invalid.error, 'foundation-invalid-target-height');

const huge = createFoundationFlattenPad({
	bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
	targetHeight: 10,
});
assert.equal(huge.ok, false, 'a malformed/giant square asset must not flatten an unlimited part of the map');
assert.equal(huge.error, 'foundation-footprint-too-large');

const longButSafe = createFoundationFlattenPad({
	metadata: { id: 'long-fortification' },
	bounds: { minX: -250, maxX: 250, minZ: -10, maxZ: 10 },
	targetHeight: 35,
}, { innerMarginMeters: 0, featherMeters: 4 });
assert.equal(longButSafe.ok, true, longButSafe.error);
assert.equal(longButSafe.pads.length, 4);
assert(longButSafe.pad.innerRadiusMeters > TERRAIN_FOUNDATION_CONFORM_POLICY.maximumInnerRadiusMeters,
	'compatibility envelope may exceed the legacy one-circle limit for a safe elongated footprint');
assert(longButSafe.pads.every((pad) => pad.innerRadiusMeters < 70),
	'safety must be evaluated against installed adaptive cells, not the obsolete enclosing circle');

// Long/narrow footprints must rotate the fixed four-pad budget along the long axis. This keeps the
// full AABB flat while reducing side feather compared with a forced 2x2 layout.
const longBuilt = createFoundationFlattenPad({
	metadata: { id: 'long-hall' },
	bounds: { minX: -50, maxX: 50, minZ: -5, maxZ: 5 },
	targetHeight: 120,
}, { innerMarginMeters: 0, featherMeters: 2 });
assert.equal(longBuilt.ok, true, longBuilt.error);
assert.equal(longBuilt.pads.length, 4);
assert(longBuilt.pads.every((pad) => Math.abs(pad.z) < 1e-9),
	'100x10m hall should rotate the four-cell budget into a 4x1 grid along its long axis');
assert.deepEqual(longBuilt.pads.map((pad) => Number(pad.x.toFixed(1))), [-37.5, -12.5, 12.5, 37.5]);
assert(longBuilt.pads.every((pad) => pad.innerRadiusMeters < 14),
	'adaptive long-axis cells must materially reduce the old 2x2 cell radius');
const compactSampler = createHeightSampler(123, undefined, longBuilt.pads);
for (const [x, z] of [[-50, -5], [-50, 5], [50, -5], [50, 5], [0, 0]]) {
	assert.equal(compactSampler(x, z), 120, `full footprint point ${x},${z} must be fully conformed`);
}
const baseSampler = createHeightSampler(123, undefined, []);
assert.equal(compactSampler(0, 8), baseSampler(0, 8), 'rectangular cells must stop after bounded side feather');
const nearSideProbeBase = baseSampler(0, 20);
assert.equal(compactSampler(0, 20), nearSideProbeBase,
	'adaptive 4x1 cells must preserve side terrain that the previous forced 2x2 cluster still feathered');
const sideProbeBase = baseSampler(0, 35);
assert.equal(compactSampler(0, 35), sideProbeBase,
	'compact footprint cluster must not flatten distant side terrain that lies inside the old enclosing-circle envelope');

const diagonal = Math.SQRT1_2;
const rotatedLongBuilt = createFoundationFlattenPad({
  metadata: { id: 'rotated-long-hall' },
  bounds: { minX: -38.891, maxX: 38.891, minZ: -38.891, maxZ: 38.891 },
  orientedFootprint: {
    centerX: 0, centerZ: 0,
    axisX: { x: diagonal, z: diagonal },
    axisZ: { x: -diagonal, z: diagonal },
    halfWidthMeters: 50,
    halfDepthMeters: 5,
  },
  targetHeight: 133,
}, { innerMarginMeters: 0, featherMeters: 2 });
assert.equal(rotatedLongBuilt.ok, true, rotatedLongBuilt.error);
assert.equal(rotatedLongBuilt.pads.length, 4);
assert(rotatedLongBuilt.pads.every((pad) => Math.abs(pad.x - pad.z) < 1e-9),
  'rotated 100x10m hall must place its four compact pads along the real diagonal long axis');
assert(rotatedLongBuilt.pads.every((pad) => pad.innerRadiusMeters < 14),
  'oriented footprint must avoid sizing pads from the much wider world AABB');
const rotatedSampler = createHeightSampler(123, undefined, rotatedLongBuilt.pads);
for (const [localX, localZ] of [[-50, -5], [-50, 5], [50, -5], [50, 5], [0, 0]]) {
  const x = diagonal * localX - diagonal * localZ;
  const z = diagonal * localX + diagonal * localZ;
  assert.equal(rotatedSampler(x, z), 133, `rotated footprint point ${localX},${localZ} must be fully conformed`);
}
const rotatedTightSideProbe = { x: -diagonal * 8, z: diagonal * 8 };
assert.equal(rotatedSampler(rotatedTightSideProbe.x, rotatedTightSideProbe.z), baseSampler(rotatedTightSideProbe.x, rotatedTightSideProbe.z), 'rotated rectangular cells must stop after bounded feather');
const rotatedSideProbe = { x: -diagonal * 25, z: diagonal * 25 };
assert.equal(rotatedSampler(rotatedSideProbe.x, rotatedSideProbe.z), baseSampler(rotatedSideProbe.x, rotatedSideProbe.z),
  'oriented foundation must preserve terrain inside the world AABB but far outside the real narrow footprint');

const tallBuilt = createFoundationFlattenPad({
	metadata: { id: 'tall-wall' },
	bounds: { minX: -4, maxX: 4, minZ: -48, maxZ: 48 },
	targetHeight: 91,
}, { innerMarginMeters: 0, featherMeters: 2 });
assert.equal(tallBuilt.ok, true, tallBuilt.error);
assert.equal(tallBuilt.pads.length, 4);
assert(tallBuilt.pads.every((pad) => Math.abs(pad.x) < 1e-9),
	'8x96m footprint should rotate into a 1x4 grid along Z');
assert.deepEqual(tallBuilt.pads.map((pad) => Number(pad.z.toFixed(1))), [-36, -12, 12, 36]);

const sharedPads = [];
const sampler = createHeightSampler(123, undefined, sharedPads);
const baseHeight = sampler(0, 0);
const raisedHeight = baseHeight + 37;
sharedPads.push({
	x: 0,
	z: 0,
	innerRadiusMeters: 8,
	outerRadiusMeters: 16,
	anchorHeightMeters: raisedHeight,
});
assert.equal(sampler(0, 0), raisedHeight, 'pre-existing sampler must observe a later pad mutation');
sharedPads.length = 0;
assert.equal(sampler(0, 0), baseHeight, 'removing the dynamic pad must restore canonical ground queries');

const events = [];
const mockManager = {
	chunkSizeMeters: 100,
	loaded: new Map([
		['0,0', {}],
		['1,0', {}],
		['2,0', {}],
		['0,1', {}],
		['-3,-3', {}],
	]),
	unloadChunk(x, z) {
		events.push(`unload:${x},${z}`);
		this.loaded.delete(`${x},${z}`);
	},
	loadChunk(x, z) {
		events.push(`load:${x},${z}`);
		this.loaded.set(`${x},${z}`, {});
	},
};

const directRebuildCount = rebuildChunksForFoundation(mockManager, {
	x: 100,
	z: 0,
	outerRadiusMeters: 20,
}, 100);
assert.equal(directRebuildCount, 1, 'only the chunk whose square intersects the pad should rebuild');
assert.deepEqual(events, ['unload:1,0', 'load:1,0']);
events.length = 0;

const unionRebuildCount = rebuildChunksForFoundations(mockManager, [
	{ x: 92, z: 0, outerRadiusMeters: 28 },
	{ x: 108, z: 0, outerRadiusMeters: 28 },
], 100);
assert.equal(unionRebuildCount, 1, 'overlapping old/new foundation pads must rebuild one resident chunk once');
assert.deepEqual(events, ['unload:1,0', 'load:1,0'], 'union rebuild must not duplicate unload/load events for one chunk');
events.length = 0;

const runtimePads = [];
const conformer = createTerrainFoundationConformer({
	flattenPads: runtimePads,
	chunkManager: mockManager,
	chunkSizeMeters: 100,
	featherMeters: 8,
});
const result = conformer.conformTerrain(payload);
assert.equal(result.ok, true, result.error);
assert.equal(result.height, payload.targetHeight);
assert.equal(runtimePads.length, 4, 'first non-degenerate placement appends one four-pad footprint cluster');
assert.equal(conformer.getDynamicPads().length, 4);
assert.equal(payloadObject.userData.terrainFoundationKey, 'object:object-keep', 'placed object must remember its runtime-instance foundation key');
assert(result.rebuiltChunkCount >= 1, 'resident terrain touched by a foundation must be regenerated');

const moved = conformer.conformTerrain({
	...payload,
	bounds: { minX: 190, maxX: 210, minZ: -10, maxZ: 10 },
	targetHeight: 82,
});
assert.equal(moved.ok, true, moved.error);
assert.equal(runtimePads.length, 4, 'same runtime object must replace, not leak, its footprint cluster');
assert(runtimePads.every((pad) => pad.foundationKey === 'object:object-keep'));
assert(runtimePads.every((pad) => pad.anchorHeightMeters === 82));

const renamed = conformer.conformTerrain({
	...payload,
	metadata: { ...payload.metadata, id: 'renamed-keep' },
	bounds: { minX: 290, maxX: 310, minZ: -10, maxZ: 10 },
	targetHeight: 84,
});
assert.equal(renamed.ok, true, renamed.error);
assert.equal(runtimePads.length, 4, 'renaming asset metadata must keep one physical-object cluster');
assert(runtimePads.every((pad) => pad.foundationKey === 'object:object-keep'));
assert.equal(payloadObject.userData.terrainFoundationKey, 'object:object-keep');

const removed = conformer.removeFoundation(payloadObject);
assert.equal(removed.ok, true, removed.error);
assert.equal(removed.removedCount, 4);
assert.equal(runtimePads.length, 0);
assert.equal(conformer.getDynamicPads().length, 0);
assert.equal(payloadObject.userData.terrainFoundationKey, undefined, 'object removal must clear remembered foundation identity');

const clonePads = [];
const cloneConformer = createTerrainFoundationConformer({ flattenPads: clonePads });
const cloneAObject = { uuid: 'tower-a', userData: {} };
const cloneBObject = { uuid: 'tower-b', userData: {} };
const sharedCloneMetadata = {
	id: 'watchtower-catalog-entry',
	assetId: 'watchtower-catalog-entry',
	src: 'assets/models/buildings/tower.glb',
	category: 'building',
};
const cloneA = cloneConformer.conformTerrain({
	metadata: sharedCloneMetadata,
	object: cloneAObject,
	bounds: { minX: -30, maxX: -20, minZ: -5, maxZ: 5 },
	targetHeight: 12,
});
const cloneB = cloneConformer.conformTerrain({
	metadata: sharedCloneMetadata,
	object: cloneBObject,
	bounds: { minX: 20, maxX: 30, minZ: -5, maxZ: 5 },
	targetHeight: 18,
});
assert.equal(cloneA.ok, true, cloneA.error);
assert.equal(cloneB.ok, true, cloneB.error);
assert.equal(clonePads.length, 8, 'two clones must retain independent four-pad terrain clusters');
assert.deepEqual([...new Set(clonePads.map((pad) => pad.foundationKey))].sort(), ['object:tower-a', 'object:tower-b']);
assert.equal(cloneAObject.userData.terrainFoundationKey, 'object:tower-a');
assert.equal(cloneBObject.userData.terrainFoundationKey, 'object:tower-b');
assert.equal(cloneConformer.removeFoundation(cloneAObject).ok, true, 'clone foundation must be removable by its object identity');
assert.equal(clonePads.length, 4, 'removing clone A must preserve clone B foundation cluster');
assert(clonePads.every((pad) => pad.foundationKey === 'object:tower-b'));

console.log('[checkTerrainFoundationConformer] PASS: adaptive four-cell foundation clusters cover AABB fallbacks and root-oriented footprints, rotate along long footprints, validate installed cell radii instead of obsolete envelope size, preserve the shared render/physics height authority, rebuild old/new influence once, and keep per-object identity.');
