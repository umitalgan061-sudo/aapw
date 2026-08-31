#!/usr/bin/env node
import assert from 'node:assert/strict';
import { inspectGlbBuffer, parseGlbJson, summarizeGlbJson } from './inspectWinterGlbMetadata.mjs';

function makeGlb(json) {
	const jsonBytes = Buffer.from(JSON.stringify(json), 'utf8');
	const paddedLength = Math.ceil(jsonBytes.length / 4) * 4;
	const totalLength = 12 + 8 + paddedLength;
	const buffer = Buffer.alloc(totalLength, 0x20);
	buffer.write('glTF', 0, 'ascii');
	buffer.writeUInt32LE(2, 4);
	buffer.writeUInt32LE(totalLength, 8);
	buffer.writeUInt32LE(paddedLength, 12);
	buffer.writeUInt32LE(0x4e4f534a, 16);
	jsonBytes.copy(buffer, 20);
	return buffer;
}

const fixture = {
	asset: { version: '2.0', generator: 'fixture-generator' },
	scene: 0,
	scenes: [{ nodes: [0] }],
	nodes: [
		{ name: 'root', translation: [10, 2, -4], children: [1] },
		{ name: 'tree-mesh-node', mesh: 0, scale: [2, 3, 4] },
	],
	meshes: [{
		name: 'tree',
		primitives: [{ attributes: { POSITION: 0 }, material: 0 }],
	}],
	accessors: [{ min: [-1, 0, -0.5], max: [1, 5, 0.5] }],
	materials: [{ name: 'snow' }],
	textures: [{}],
	images: [{}],
	extensionsUsed: ['KHR_materials_specular'],
};

const buffer = makeGlb(fixture);
assert.deepEqual(parseGlbJson(buffer), fixture, 'GLB JSON chunk must round-trip without BIN data');
const summary = inspectGlbBuffer(buffer);
assert.equal(summary.generator, 'fixture-generator');
assert.equal(summary.nodes, 2);
assert.equal(summary.meshes, 1);
assert.equal(summary.materials, 1);
assert.equal(summary.textures, 1);
assert.equal(summary.images, 1);
assert.equal(summary.boundedPrimitives, 1);
assert.deepEqual(summary.bounds.min, [8, 2, -6]);
assert.deepEqual(summary.bounds.max, [12, 17, -2]);
assert.deepEqual(summary.size, [4, 15, 4]);
assert.deepEqual(summary.center, [10, 9.5, -4]);
assert.equal(summary.horizontalToHeightRatio, 4 / 15);
assert.equal(summary.baseOffsetY, 2);
assert.deepEqual([...summary.meshNames], ['tree']);
assert.deepEqual([...summary.nodeNames], ['root', 'tree-mesh-node']);
assert.deepEqual([...summary.extensionsUsed], ['KHR_materials_specular']);

const rotated = summarizeGlbJson({
	asset: { version: '2.0' },
	scenes: [{ nodes: [0] }],
	nodes: [{
		mesh: 0,
		rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2],
	}],
	meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }],
	accessors: [{ min: [-1, 0, -3], max: [1, 2, 3] }],
});
assert(Math.abs(rotated.size[0] - 6) < 1e-12, 'node quaternion must rotate Z extent into X');
assert(Math.abs(rotated.size[2] - 2) < 1e-12, 'node quaternion must rotate X extent into Z');
assert.equal(rotated.size[1], 2);

assert.throws(() => parseGlbJson(Buffer.alloc(8)), /header and JSON chunk/);
const wrongVersion = Buffer.from(buffer);
wrongVersion.writeUInt32LE(1, 4);
assert.throws(() => parseGlbJson(wrongVersion), /version 2/);

console.log('[checkWinterGlbMetadataInspector] PASS', JSON.stringify({
	fixtureSize: summary.size,
	fixtureRatio: summary.horizontalToHeightRatio,
	rotatedSize: rotated.size,
}));
