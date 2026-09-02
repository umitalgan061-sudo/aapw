#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..');
const GLB_MAGIC = 0x46546c67;
const GLB_JSON_CHUNK = 0x4e4f534a;
const GLB_BIN_CHUNK = 0x004e4942;
const SINGLE_TREE_MAX_HORIZONTAL_TO_HEIGHT_RATIO = 1.12;

const CANDIDATES = Object.freeze([
	Object.freeze({
		id: 'mature-broadleaf',
		path: 'assets/models/vegetation/big_tree_by_3donimus_dnwh762pn_6_1_na.glb',
		expectedRole: 'temperate-broadleaf-single-tree',
	}),
	Object.freeze({
		id: 'birch-family',
		path: 'assets/models/vegetation/birch_trees_R7qMWzb7nk.glb',
		expectedRole: 'temperate-birch-family',
	}),
	Object.freeze({
		id: 'fall-tree',
		path: 'assets/models/vegetation/fall_tree_4GYen9Xm3Kj.glb',
		expectedRole: 'temperate-deciduous-single-tree',
	}),
]);

function parseArgs(argv) {
	const outputToken = argv.find((token) => token.startsWith('--output='));
	return { output: outputToken ? outputToken.slice('--output='.length) : null };
}

function isLfsPointer(buffer) {
	return buffer.length < 1024 && buffer.subarray(0, Math.min(buffer.length, 200)).toString('utf8')
		.startsWith('version https://git-lfs.github.com/spec/v1');
}

function parseGlb(buffer, sourcePath) {
	assert(buffer.length > 20, `${sourcePath}: GLB is too small`);
	assert.equal(buffer.readUInt32LE(0), GLB_MAGIC, `${sourcePath}: invalid GLB magic`);
	assert.equal(buffer.readUInt32LE(4), 2, `${sourcePath}: only glTF 2 GLB is supported`);
	assert.equal(buffer.readUInt32LE(8), buffer.length, `${sourcePath}: GLB declared length mismatch`);
	let offset = 12;
	let json = null;
	let bin = null;
	while (offset + 8 <= buffer.length) {
		const chunkLength = buffer.readUInt32LE(offset);
		const chunkType = buffer.readUInt32LE(offset + 4);
		const start = offset + 8;
		const end = start + chunkLength;
		assert(end <= buffer.length, `${sourcePath}: GLB chunk escapes file bounds`);
		if (chunkType === GLB_JSON_CHUNK) json = JSON.parse(buffer.subarray(start, end).toString('utf8').trim());
		else if (chunkType === GLB_BIN_CHUNK && !bin) bin = buffer.subarray(start, end);
		offset = end;
	}
	assert(json?.asset?.version?.startsWith('2'), `${sourcePath}: missing glTF 2 JSON asset metadata`);
	return { json, bin };
}

function identityMatrix() {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

function multiplyMatrix(a, b) {
	const out = new Array(16).fill(0);
	for (let column = 0; column < 4; column += 1) {
		for (let row = 0; row < 4; row += 1) {
			for (let k = 0; k < 4; k += 1) out[column * 4 + row] += a[k * 4 + row] * b[column * 4 + k];
		}
	}
	return out;
}

function matrixFromTrs(node = {}) {
	if (Array.isArray(node.matrix) && node.matrix.length === 16) return [...node.matrix];
	const [tx, ty, tz] = node.translation ?? [0, 0, 0];
	const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1];
	const [sx, sy, sz] = node.scale ?? [1, 1, 1];
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2;
	const yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;
	return [
		(1 - (yy + zz)) * sx, (xy + wz) * sx, (xz - wy) * sx, 0,
		(xy - wz) * sy, (1 - (xx + zz)) * sy, (yz + wx) * sy, 0,
		(xz + wy) * sz, (yz - wx) * sz, (1 - (xx + yy)) * sz, 0,
		tx, ty, tz, 1,
	];
}

function transformPoint(matrix, x, y, z) {
	return [
		matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12],
		matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13],
		matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14],
	];
}

function expandBounds(bounds, point) {
	for (let axis = 0; axis < 3; axis += 1) {
		bounds.min[axis] = Math.min(bounds.min[axis], point[axis]);
		bounds.max[axis] = Math.max(bounds.max[axis], point[axis]);
	}
}

function primitiveBounds(gltf, primitive, worldMatrix) {
	const positionAccessorIndex = primitive?.attributes?.POSITION;
	const accessor = Number.isInteger(positionAccessorIndex) ? gltf.accessors?.[positionAccessorIndex] : null;
	if (!accessor || !Array.isArray(accessor.min) || !Array.isArray(accessor.max)) return null;
	const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
	for (const x of [accessor.min[0], accessor.max[0]]) {
		for (const y of [accessor.min[1], accessor.max[1]]) {
			for (const z of [accessor.min[2], accessor.max[2]]) expandBounds(bounds, transformPoint(worldMatrix, x, y, z));
		}
	}
	return bounds;
}

function finalizeBounds(bounds, boundedPrimitiveCount) {
	if (!boundedPrimitiveCount) return null;
	const size = bounds.max.map((value, axis) => value - bounds.min[axis]);
	const horizontal = Math.max(size[0], size[2]);
	return {
		min: bounds.min,
		max: bounds.max,
		size,
		height: size[1],
		horizontal,
		horizontalToHeightRatio: size[1] > 0 ? horizontal / size[1] : Infinity,
		boundedPrimitiveCount,
	};
}

function modelBounds(gltf) {
	const bounds = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
	let boundedPrimitiveCount = 0;
	walkRenderableNodes(gltf, ({ primitives, worldMatrix }) => {
		for (const primitive of primitives) {
			const primitiveBox = primitiveBounds(gltf, primitive, worldMatrix);
			if (!primitiveBox) continue;
			expandBounds(bounds, primitiveBox.min);
			expandBounds(bounds, primitiveBox.max);
			boundedPrimitiveCount += 1;
		}
	});
	return finalizeBounds(bounds, boundedPrimitiveCount);
}

function walkRenderableNodes(gltf, visitor) {
	const childSet = new Set((gltf.nodes ?? []).flatMap((node) => node.children ?? []));
	const defaultScene = gltf.scenes?.[gltf.scene ?? 0];
	const roots = defaultScene?.nodes?.length
		? defaultScene.nodes
		: (gltf.nodes ?? []).map((_, index) => index).filter((index) => !childSet.has(index));
	function visit(nodeIndex, parentMatrix) {
		const node = gltf.nodes?.[nodeIndex];
		if (!node) return;
		const worldMatrix = multiplyMatrix(parentMatrix, matrixFromTrs(node));
		if (Number.isInteger(node.mesh)) {
			visitor({ nodeIndex, node, meshIndex: node.mesh, primitives: gltf.meshes?.[node.mesh]?.primitives ?? [], worldMatrix });
		}
		for (const childIndex of node.children ?? []) visit(childIndex, worldMatrix);
	}
	for (const root of roots) visit(root, identityMatrix());
}

function usedMaterialSummary(gltf, primitives) {
	const indices = [...new Set(primitives.map((primitive) => primitive.material).filter(Number.isInteger))];
	const materials = gltf.materials ?? [];
	const usedMaterials = indices.map((index) => materials[index]).filter(Boolean);
	return {
		indices,
		usedMaterials,
		texturedCount: usedMaterials.filter((material) => Number.isInteger(material?.pbrMetallicRoughness?.baseColorTexture?.index)).length,
		normalMappedCount: usedMaterials.filter((material) => Number.isInteger(material?.normalTexture?.index)).length,
		alphaSurfaceCount: usedMaterials.filter((material) => material?.alphaMode === 'MASK' || material?.alphaMode === 'BLEND').length,
	};
}

function meshNodeComponents(gltf, imageCount) {
	const components = [];
	walkRenderableNodes(gltf, ({ nodeIndex, node, meshIndex, primitives, worldMatrix }) => {
		const boundsAccumulator = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] };
		let boundedPrimitiveCount = 0;
		for (const primitive of primitives) {
			const primitiveBox = primitiveBounds(gltf, primitive, worldMatrix);
			if (!primitiveBox) continue;
			expandBounds(boundsAccumulator, primitiveBox.min);
			expandBounds(boundsAccumulator, primitiveBox.max);
			boundedPrimitiveCount += 1;
		}
		const bounds = finalizeBounds(boundsAccumulator, boundedPrimitiveCount);
		if (!bounds || bounds.height <= 0.05) return;
		const material = usedMaterialSummary(gltf, primitives);
		const shapeLooksSingleTree = bounds.horizontalToHeightRatio <= SINGLE_TREE_MAX_HORIZONTAL_TO_HEIGHT_RATIO;
		const hasTextureEvidence = material.texturedCount > 0 && imageCount > 0;
		components.push({
			id: node.name || `node-${nodeIndex}`,
			nodeIndex,
			meshIndex,
			meshName: gltf.meshes?.[meshIndex]?.name ?? null,
			primitiveCount: primitives.length,
			usedMaterialSlots: material.indices.length,
			materialNames: material.usedMaterials.map((entry) => entry?.name ?? null),
			texturedUsedMaterialCount: material.texturedCount,
			normalMappedUsedMaterialCount: material.normalMappedCount,
			alphaSurfaceCount: material.alphaSurfaceCount,
			bounds,
			materialStrategy: material.indices.length >= 2 ? 'named-part' : 'layered-fallback',
			shapeLooksSingleTree,
			hasTextureEvidence,
			liveCandidate: shapeLooksSingleTree && hasTextureEvidence,
		});
	});
	return components;
}

function imageBytes(gltf, bin, image) {
	if (Number.isInteger(image?.bufferView) && bin) {
		const view = gltf.bufferViews?.[image.bufferView];
		if (!view || (view.buffer ?? 0) !== 0) return null;
		const start = view.byteOffset ?? 0;
		return bin.subarray(start, start + view.byteLength);
	}
	if (typeof image?.uri === 'string' && image.uri.startsWith('data:')) {
		const comma = image.uri.indexOf(',');
		if (comma >= 0) return Buffer.from(image.uri.slice(comma + 1), image.uri.slice(0, comma).includes(';base64') ? 'base64' : 'utf8');
	}
	return null;
}

function pngDimensions(bytes) {
	if (!bytes || bytes.length < 24 || bytes.readUInt32BE(0) !== 0x89504e47) return null;
	return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20), format: 'png' };
}

function jpegDimensions(bytes) {
	if (!bytes || bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 0xff) { offset += 1; continue; }
		const marker = bytes[offset + 1];
		if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
		const length = bytes.readUInt16BE(offset + 2);
		if (length < 2 || offset + 2 + length > bytes.length) break;
		if ((marker >= 0xc0 && marker <= 0xc3) || (marker >= 0xc5 && marker <= 0xc7)
			|| (marker >= 0xc9 && marker <= 0xcb) || (marker >= 0xcd && marker <= 0xcf)) {
			return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5), format: 'jpeg' };
		}
		offset += 2 + length;
	}
	return null;
}

function textureSummary(gltf, bin) {
	return (gltf.images ?? []).map((image, imageIndex) => {
		const bytes = imageBytes(gltf, bin, image);
		const dimensions = pngDimensions(bytes) ?? jpegDimensions(bytes);
		return {
			imageIndex,
			name: image.name ?? null,
			mimeType: image.mimeType ?? null,
			embeddedBytes: bytes?.length ?? null,
			width: dimensions?.width ?? null,
			height: dimensions?.height ?? null,
			format: dimensions?.format ?? null,
			externalUri: typeof image.uri === 'string' && !image.uri.startsWith('data:') ? image.uri : null,
		};
	});
}

function auditCandidate(candidate) {
	const absolutePath = path.join(repoRoot, candidate.path);
	const file = fs.readFileSync(absolutePath);
	assert(!isLfsPointer(file), `${candidate.path}: Git LFS pointer was not hydrated`);
	const { json: gltf, bin } = parseGlb(file, candidate.path);
	const primitives = (gltf.meshes ?? []).flatMap((mesh) => mesh.primitives ?? []);
	assert(primitives.length > 0, `${candidate.path}: no renderable mesh primitives`);
	const material = usedMaterialSummary(gltf, primitives);
	const images = textureSummary(gltf, bin);
	const bounds = modelBounds(gltf);
	assert(bounds && Number.isFinite(bounds.height) && bounds.height > 0.05, `${candidate.path}: finite model bounds were not recoverable`);
	const maxTextureDimension = images.reduce((max, image) => Math.max(max, image.width ?? 0, image.height ?? 0), 0);
	const materialStrategy = material.indices.length >= 2 ? 'named-part' : 'layered-fallback';
	const shapeLooksSingleTree = bounds.horizontalToHeightRatio <= SINGLE_TREE_MAX_HORIZONTAL_TO_HEIGHT_RATIO;
	const hasTextureEvidence = material.texturedCount > 0 && images.length > 0;
	const wholeModelLiveCandidate = shapeLooksSingleTree && hasTextureEvidence;
	const components = meshNodeComponents(gltf, images.length);
	const liveComponents = components.filter((component) => component.liveCandidate);
	const liveCandidate = wholeModelLiveCandidate || liveComponents.length > 0;
	const rejectionReasons = [];
	if (!shapeLooksSingleTree) rejectionReasons.push('whole-model-horizontal-to-height-ratio-exceeds-single-tree-envelope');
	if (!hasTextureEvidence) rejectionReasons.push('whole-model-missing-used-base-color-texture-evidence');
	return {
		id: candidate.id,
		path: candidate.path,
		expectedRole: candidate.expectedRole,
		fileBytes: file.length,
		meshCount: gltf.meshes?.length ?? 0,
		nodeCount: gltf.nodes?.length ?? 0,
		primitiveCount: primitives.length,
		materialCount: gltf.materials?.length ?? 0,
		usedMaterialSlots: material.indices.length,
		unassignedPrimitiveCount: primitives.filter((primitive) => !Number.isInteger(primitive.material)).length,
		texturedUsedMaterialCount: material.texturedCount,
		normalMappedUsedMaterialCount: material.normalMappedCount,
		alphaSurfaceCount: material.alphaSurfaceCount,
		materialNames: material.usedMaterials.map((entry) => entry?.name ?? null),
		imageCount: images.length,
		maxTextureDimension,
		images,
		bounds,
		materialStrategy,
		shapeLooksSingleTree,
		hasTextureEvidence,
		wholeModelLiveCandidate,
		components,
		liveComponentIds: liveComponents.map((component) => component.id),
		selectionMode: wholeModelLiveCandidate ? 'whole-model' : liveComponents.length ? 'mesh-node-component' : null,
		liveCandidate,
		rejectionReasons,
	};
}

const args = parseArgs(process.argv.slice(2));
const candidates = CANDIDATES.map(auditCandidate);
const report = Object.freeze({
	contract: 'temperate-vegetation-asset-first-audit-v3-component-qualification',
	singleTreeMaxHorizontalToHeightRatio: SINGLE_TREE_MAX_HORIZONTAL_TO_HEIGHT_RATIO,
	candidates,
	liveCandidates: candidates.filter((candidate) => candidate.liveCandidate).map((candidate) => candidate.id),
	liveSourceComponents: candidates.flatMap((candidate) => candidate.liveComponentIds.map((componentId) => `${candidate.id}:${componentId}`)),
	layeredFallbackCandidates: candidates.filter((candidate) => candidate.liveCandidate && candidate.materialStrategy === 'layered-fallback').map((candidate) => candidate.id),
	namedPartCandidates: candidates.filter((candidate) => candidate.liveCandidate && candidate.materialStrategy === 'named-part').map((candidate) => candidate.id),
});
if (args.output) {
	const outputPath = path.resolve(repoRoot, args.output);
	fs.mkdirSync(path.dirname(outputPath), { recursive: true });
	fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}
assert(candidates.every((candidate) => candidate.fileBytes > 512), 'all audited tree candidates must be hydrated real GLBs');
assert(candidates.some((candidate) => candidate.hasTextureEvidence), 'no audited temperate tree retained real texture evidence');
console.log('[checkTemperateVegetationAssetCandidates] AUDIT', JSON.stringify(report));