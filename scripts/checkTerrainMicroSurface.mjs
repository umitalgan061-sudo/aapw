#!/usr/bin/env node
import assert from 'node:assert/strict';
import * as THREE from 'three';
import {
	applyTerrainMicroSurface,
	createHeightSampler,
	createTerrainChunk,
	disposeTerrainChunk,
	TERRAIN_MICRO_SURFACE_POLICY,
} from '../src/3d/world/terrain.js';

const EPSILON = 1e-6;
const CHUNK_SIZE = 500;

function assertClose(actual, expected, label) {
	assert.ok(Math.abs(actual - expected) <= EPSILON, `${label}: ${actual} !== ${expected}`);
}

function channelRange(data, channel) {
	let min = 255;
	let max = 0;
	for (let index = channel; index < data.length; index += 4) {
		min = Math.min(min, data[index]);
		max = Math.max(max, data[index]);
	}
	return { min, max };
}

assert.equal(TERRAIN_MICRO_SURFACE_POLICY.id, 'terrain-micro-surface-pbr-v1');
assert.ok(TERRAIN_MICRO_SURFACE_POLICY.textureSize >= 128);
assert.ok(TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters >= 12);
assert.ok(TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters <= 32);
assert.ok(TERRAIN_MICRO_SURFACE_POLICY.normalStrength > 0.4);
assert.ok(TERRAIN_MICRO_SURFACE_POLICY.normalStrength < 1.2);

const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
applyTerrainMicroSurface(material, { chunkSizeMeters: CHUNK_SIZE });
const expectedRepeat = CHUNK_SIZE / TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters;
assert.ok(material.normalMap?.isDataTexture, 'terrain needs a generated normal DataTexture');
assert.ok(material.roughnessMap?.isDataTexture, 'terrain needs a generated roughness DataTexture');
assert.equal(material.normalMap.wrapS, THREE.RepeatWrapping);
assert.equal(material.normalMap.wrapT, THREE.RepeatWrapping);
assert.equal(material.roughnessMap.wrapS, THREE.RepeatWrapping);
assert.equal(material.roughnessMap.wrapT, THREE.RepeatWrapping);
assert.equal(material.normalMap.colorSpace, THREE.NoColorSpace);
assert.equal(material.roughnessMap.colorSpace, THREE.NoColorSpace);
assertClose(material.normalMap.repeat.x, expectedRepeat, 'normal repeat x');
assertClose(material.normalMap.repeat.y, expectedRepeat, 'normal repeat y');
assertClose(material.roughnessMap.repeat.x, expectedRepeat, 'roughness repeat x');
assertClose(material.normalScale.x, TERRAIN_MICRO_SURFACE_POLICY.normalStrength, 'normal strength x');
assertClose(material.normalScale.y, TERRAIN_MICRO_SURFACE_POLICY.normalStrength, 'normal strength y');
assert.equal(material.userData.terrainMicroSurface.renderOnly, true);
assert.equal(material.userData.terrainMicroSurface.policyId, TERRAIN_MICRO_SURFACE_POLICY.id);

const normalData = material.normalMap.image.data;
const roughnessData = material.roughnessMap.image.data;
const normalXRange = channelRange(normalData, 0);
const normalYRange = channelRange(normalData, 1);
const normalZRange = channelRange(normalData, 2);
const roughnessRange = channelRange(roughnessData, 1);
assert.ok(normalXRange.max - normalXRange.min > 40, 'normal atlas must vary along tangent X');
assert.ok(normalYRange.max - normalYRange.min > 40, 'normal atlas must vary along tangent Y');
assert.ok(normalZRange.min > 90, 'micro normals must remain upward-facing');
assert.ok(roughnessRange.max - roughnessRange.min > 20, 'roughness atlas must not be flat');

// Production geometry must still use the same canonical sampler. The new layer is render-only.
const sampler = createHeightSampler(12345);
const chunk = createTerrainChunk({ chunkX: 0, chunkZ: 0, size: CHUNK_SIZE, segments: 4, seed: 12345 });
assert.equal(chunk.material.userData.terrainMicroSurface.policyId, TERRAIN_MICRO_SURFACE_POLICY.id);
const positions = chunk.geometry.attributes.position;
for (const index of [0, 6, 12, 18, 24]) {
	const worldX = chunk.position.x + positions.getX(index);
	const worldZ = chunk.position.z + positions.getZ(index);
	assertClose(positions.getY(index), sampler(worldX, worldZ), `canonical height vertex ${index}`);
}
assert.equal(chunk.userData.currentTerrainSingleSource, true);
disposeTerrainChunk(chunk);
material.dispose();

console.log('[checkTerrainMicroSurface] PASS deterministic PBR micro-detail is render-only and canonical heights remain exact');