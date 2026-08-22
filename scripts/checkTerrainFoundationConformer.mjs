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
assert.equal(built.key, 'asset:test-keep');
assert.equal(built.pad.x, 100);
assert.equal(built.pad.z, -50);
assert.equal(built.pad.anchorHeightMeters, 71.25);
assert(built.pad.innerRadiusMeters >= Math.hypot(8, 6), 'inner pad must enclose every footprint corner');
assert.equal(built.pad.outerRadiusMeters, built.pad.innerRadiusMeters + 9);
assert.equal(built.pad.source, TERRAIN_FOUNDATION_CONFORM_POLICY.id);
assert.equal(TERRAIN_FOUNDATION_CONFORM_POLICY.chunkRebuildMode, 'union-deduplicated');

const invalid = createFoundationFlattenPad({ bounds: payload.bounds, targetHeight: Number.NaN });
assert.equal(invalid.ok, false);
assert.equal(invalid.error, 'foundation-invalid-target-height');

const huge = createFoundationFlattenPad({
	bounds: { minX: -500, maxX: 500, minZ: -500, maxZ: 500 },
	targetHeight: 10,
});
assert.equal(huge.ok, false, 'a malformed/giant asset must not flatten an unlimited part of the map');
assert.equal(huge.error, 'foundation-footprint-too-large');

// Prove the existing terrain sampler observes pads appended *after* the sampler was created. This is
// the render/physics bridge's central invariant: sceneManager constructs the collider once, then a
// later structure placement mutates the same array and the collider must immediately read the pad.
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

// Mock a resident chunk manager. Only chunks touched by the new pad may be rebuilt.
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

// Two influence circles can overlap the same resident terrain. A move/scale update must rebuild the
// union once, not unload/load the same GPU chunk once for the old pad and again for the new pad.
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
assert.equal(runtimePads.length, 1, 'first placement appends one dynamic pad');
assert.equal(conformer.getDynamicPads().length, 1);
assert.equal(payloadObject.userData.terrainFoundationKey, 'asset:test-keep', 'placed object must remember the exact installed foundation key');
assert(result.rebuiltChunkCount >= 1, 'resident terrain touched by a foundation must be regenerated');

// Re-placing the same asset must update, not duplicate, its pad. This matters for editor moves and
// autonomous agents re-running placement on the same asset id.
const moved = conformer.conformTerrain({
	...payload,
	bounds: { minX: 190, maxX: 210, minZ: -10, maxZ: 10 },
	targetHeight: 82,
});
assert.equal(moved.ok, true, moved.error);
assert.equal(runtimePads.length, 1, 'same asset id must not leak duplicate flatten pads');
assert.equal(runtimePads[0].x, 200);
assert.equal(runtimePads[0].z, 0);
assert.equal(runtimePads[0].anchorHeightMeters, 82);

// If authoring changes the same physical object's id, the remembered key must retire the old pad
// before the new identity is installed. Otherwise one moved/renamed building can leave two terrain
// islands behind while render and physics continue reading both.
const rekeyed = conformer.conformTerrain({
	...payload,
	metadata: { ...payload.metadata, id: 'renamed-keep' },
	bounds: { minX: 290, maxX: 310, minZ: -10, maxZ: 10 },
	targetHeight: 84,
});
assert.equal(rekeyed.ok, true, rekeyed.error);
assert.equal(runtimePads.length, 1, 'same physical object with a new id must retire its old pad');
assert.equal(runtimePads[0].foundationKey, 'asset:renamed-keep');
assert.equal(payloadObject.userData.terrainFoundationKey, 'asset:renamed-keep');
assert.equal(runtimePads[0].x, 300);

const removed = conformer.removeFoundation(payloadObject);
assert.equal(removed.ok, true, removed.error);
assert.equal(runtimePads.length, 0);
assert.equal(conformer.getDynamicPads().length, 0);
assert.equal(payloadObject.userData.terrainFoundationKey, undefined, 'object removal must clear remembered foundation identity');

// Two runtime clones can legitimately share one GLB/FBX src. Their foundations must remain separate;
// src identifies the model resource, not the placed structure instance.
const clonePads = [];
const cloneConformer = createTerrainFoundationConformer({ flattenPads: clonePads });
const cloneAObject = { uuid: 'tower-a', userData: {} };
const cloneBObject = { uuid: 'tower-b', userData: {} };
const cloneA = cloneConformer.conformTerrain({
	metadata: { src: 'assets/models/buildings/tower.glb', category: 'building' },
	object: cloneAObject,
	bounds: { minX: -30, maxX: -20, minZ: -5, maxZ: 5 },
	targetHeight: 12,
});
const cloneB = cloneConformer.conformTerrain({
	metadata: { src: 'assets/models/buildings/tower.glb', category: 'building' },
	object: cloneBObject,
	bounds: { minX: 20, maxX: 30, minZ: -5, maxZ: 5 },
	targetHeight: 18,
});
assert.equal(cloneA.ok, true, cloneA.error);
assert.equal(cloneB.ok, true, cloneB.error);
assert.equal(clonePads.length, 2, 'clones sharing one src must retain independent terrain pads');
assert.deepEqual(clonePads.map((pad) => pad.foundationKey).sort(), ['object:tower-a', 'object:tower-b']);
assert.deepEqual(clonePads.map((pad) => pad.x).sort((a, b) => a - b), [-25, 25]);
assert.equal(cloneAObject.userData.terrainFoundationKey, 'object:tower-a');
assert.equal(cloneBObject.userData.terrainFoundationKey, 'object:tower-b');
assert.equal(cloneConformer.removeFoundation(cloneAObject).ok, true, 'clone foundation must be removable by its object identity');
assert.equal(clonePads.length, 1, 'removing clone A must preserve clone B foundation');
assert.equal(clonePads[0].foundationKey, 'object:tower-b');

console.log('[checkTerrainFoundationConformer] PASS: footprint pads enclose the full base, mutate one shared render/physics height authority, rebuild the union of old/new influence once, remember/rekey/remove object-owned foundations safely, and keep cloned structures independent.');