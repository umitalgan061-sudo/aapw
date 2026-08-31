#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const JSON_CHUNK_TYPE = 0x4e4f534a;

export const WINTER_GLB_INSPECTION_ASSETS = Object.freeze([
	'assets/models/vegetation/winter_tree.glb',
	'assets/models/vegetation/dead_trees_with_snow_iEuwXWner0.glb',
]);

function identityMatrix() {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrices(a, b) {
	const out = new Array(16).fill(0);
	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			for (let k = 0; k < 4; k += 1) {
				out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
			}
		}
	}
	return out;
}

function matrixFromNode(node = {}) {
	if (Array.isArray(node.matrix) && node.matrix.length === 16) return [...node.matrix];
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [qx, qy, qz, qw] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	const x2 = qx + qx;
	const y2 = qy + qy;
	const z2 = qz + qz;
	const xx = qx * x2;
	const xy = qx * y2;
	const xz = qx * z2;
	const yy = qy * y2;
	const yz = qy * z2;
	const zz = qz * z2;
	const wx = qw * x2;
	const wy = qw * y2;
	const wz = qw * z2;
	return [
		(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
		(xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
		(xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
		tx, ty, tz, 1,
	];
}

function transformPoint(matrix, point) {
	const [x, y, z] = point;
	return [
		matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
		matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
		matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
	];
}

function emptyBounds() {
	return { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
}

function includePoint(bounds, point) {
	for (let axis = 0; axis < 3; axis += 1) {
		bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
		bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
	}
}

function includeTransformedBox(target, local, matrix) {
	for (const x of [local.min[0], local.max[0]]) {
		for (const y of [local.min[1], local.max[1]]) {
			for (const z of [local.min[2], local.max[2]]) includePoint(target, transformPoint(matrix, [x, y, z]));
		}
	}
}

function finiteBounds(bounds) {
	return [...bounds.min, ...bounds.max].every(Number.isFinite);
}

export function parseGlbJson(buffer) {
	assert(buffer.length >= 20, 'GLB must contain a header and JSON chunk');
	assert.equal(buffer.subarray(0, 4).toString('ascii'), 'glTF', 'GLB magic must be glTF');
	assert.equal(buffer.readUInt32LE(4), 2, 'GLB must use glTF version 2');
	assert.equal(buffer.readUInt32LE(8), buffer.length, 'GLB declared length must match file bytes');
	let offset = 12;
	while (offset + 8 <= buffer.length) {
		const chunkLength = buffer.readUInt32LE(offset);
		const chunkType = buffer.readUInt32LE(offset + 4);
		const start = offset + 8;
		const end = start + chunkLength;
		assert(end <= buffer.length, 'GLB chunk must remain inside declared file bounds');
		if (chunkType === JSON_CHUNK_TYPE) {
			const jsonText = buffer.subarray(start, end).toString('utf8').replace(/[\u0000\u0020]+$/g, '');
			return JSON.parse(jsonText);
		}
		offset = end;
	}
	throw new Error('GLB JSON chunk was not found');
}

function meshLocalBounds(gltf, meshIndex) {
	const mesh = gltf.meshes?.[meshIndex];
	if (!mesh) return null;
	const bounds = emptyBounds();
	let boundedPrimitives = 0;
	let missingBoundsPrimitives = 0;
	for (const primitive of mesh.primitives ?? []) {
		const accessorIndex = primitive.attributes?.POSITION;
		const accessor = Number.isInteger(accessorIndex) ? gltf.accessors?.[accessorIndex] : null;
		if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)
			|| accessor.min.length < 3 || accessor.max.length < 3) {
			missingBoundsPrimitives += 1;
			continue;
		}
		includePoint(bounds, accessor.min);
		includePoint(bounds, accessor.max);
		boundedPrimitives += 1;
	}
	return finiteBounds(bounds) ? { bounds, boundedPrimitives, missingBoundsPrimitives } : null;
}

function rootNodeIndexes(gltf, scene) {
	if (Array.isArray(scene?.nodes)) return scene.nodes;
	const children = new Set((gltf.nodes ?? []).flatMap((node) => node.children ?? []));
	return (gltf.nodes ?? []).map((_, index) => index).filter((index) => !children.has(index));
}

export function summarizeGlbJson(gltf) {
	const scene = gltf.scenes?.[gltf.scene ?? 0] ?? gltf.scenes?.[0] ?? null;
	const worldBounds = emptyBounds();
	let meshNodes = 0;
	let boundedMeshNodes = 0;
	let boundedPrimitives = 0;
	let missingBoundsPrimitives = 0;
	const visited = new Set();

	function visit(nodeIndex, parentMatrix) {
		assert(!visited.has(nodeIndex), `node graph must not cycle at node ${nodeIndex}`);
		visited.add(nodeIndex);
		const node = gltf.nodes?.[nodeIndex];
		if (!node) return;
		const worldMatrix = multiplyMatrices(parentMatrix, matrixFromNode(node));
		if (Number.isInteger(node.mesh)) {
			meshNodes += 1;
			const local = meshLocalBounds(gltf, node.mesh);
			if (local) {
				includeTransformedBox(worldBounds, local.bounds, worldMatrix);
				boundedMeshNodes += 1;
				boundedPrimitives += local.boundedPrimitives;
				missingBoundsPrimitives += local.missingBoundsPrimitives;
			}
		}
		for (const child of node.children ?? []) visit(child, worldMatrix);
		visited.delete(nodeIndex);
	}

	for (const root of rootNodeIndexes(gltf, scene)) visit(root, identityMatrix());
	const hasBounds = finiteBounds(worldBounds);
	const size = hasBounds ? worldBounds.max.map((value, axis) => value - worldBounds.min[axis]) : null;
	const center = hasBounds ? worldBounds.max.map((value, axis) => (value + worldBounds.min[axis]) * 0.5) : null;
	const horizontal = size ? Math.max(size[0], size[2]) : null;
	const horizontalToHeightRatio = size && size[1] > 0 ? horizontal / size[1] : null;

	return Object.freeze({
		generator: gltf.asset?.generator ?? null,
		assetVersion: gltf.asset?.version ?? null,
		scenes: gltf.scenes?.length ?? 0,
		nodes: gltf.nodes?.length ?? 0,
		meshes: gltf.meshes?.length ?? 0,
		meshNodes,
		materials: gltf.materials?.length ?? 0,
		textures: gltf.textures?.length ?? 0,
		images: gltf.images?.length ?? 0,
		animations: gltf.animations?.length ?? 0,
		extensionsUsed: Object.freeze([...(gltf.extensionsUsed ?? [])]),
		boundedMeshNodes,
		boundedPrimitives,
		missingBoundsPrimitives,
		bounds: hasBounds ? Object.freeze({ min: [...worldBounds.min], max: [...worldBounds.max] }) : null,
		size: size ? Object.freeze(size) : null,
		center: center ? Object.freeze(center) : null,
		horizontalToHeightRatio,
		baseOffsetY: hasBounds ? worldBounds.min[1] : null,
		meshNames: Object.freeze((gltf.meshes ?? []).map((mesh) => mesh.name).filter(Boolean).slice(0, 16)),
		nodeNames: Object.freeze((gltf.nodes ?? []).map((node) => node.name).filter(Boolean).slice(0, 24)),
	});
}

export function inspectGlbBuffer(buffer) {
	return summarizeGlbJson(parseGlbJson(buffer));
}

async function main() {
	const report = {};
	for (const assetPath of WINTER_GLB_INSPECTION_ASSETS) {
		const buffer = await readFile(path.join(ROOT, assetPath));
		report[assetPath] = inspectGlbBuffer(buffer);
	}
	console.log('[inspectWinterGlbMetadata] PASS', JSON.stringify(report));
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invokedPath === import.meta.url) {
	main().catch((error) => {
		console.error('[inspectWinterGlbMetadata] FAIL', error?.stack ?? error);
		process.exitCode = 1;
	});
}
