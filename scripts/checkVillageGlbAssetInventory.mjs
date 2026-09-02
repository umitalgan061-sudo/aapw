#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { classifyPart } from '../src/3d/materials/meshPartClassifier.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VILLAGE_SOURCE = path.join(ROOT, 'src/3d/world/villages.js');
const JSON_CHUNK = 0x4E4F534A;
const BIN_CHUNK = 0x004E4942;

function collectVillageAssets() {
	const source = fs.readFileSync(VILLAGE_SOURCE, 'utf8');
	const matches = [...source.matchAll(/\b(?:assetUrl|secondaryAssetUrl):\s*'([^']+\.glb)'/g)].map((match) => match[1]);
	return [...new Set(matches)].sort();
}

function parseGlb(buffer, assetPath) {
	assert(buffer.length >= 20, `${assetPath}: GLB too short`);
	assert.equal(buffer.subarray(0, 4).toString('ascii'), 'glTF', `${assetPath}: invalid GLB magic`);
	assert.equal(buffer.readUInt32LE(4), 2, `${assetPath}: only glTF 2.0 GLB is supported`);
	assert.equal(buffer.readUInt32LE(8), buffer.length, `${assetPath}: declared GLB byteLength mismatch`);

	const chunks = [];
	let offset = 12;
	while (offset < buffer.length) {
		assert(offset + 8 <= buffer.length, `${assetPath}: truncated chunk header`);
		const length = buffer.readUInt32LE(offset);
		const type = buffer.readUInt32LE(offset + 4);
		offset += 8;
		assert(offset + length <= buffer.length, `${assetPath}: chunk exceeds GLB length`);
		chunks.push({ type, data: buffer.subarray(offset, offset + length) });
		offset += length;
	}
	assert.equal(offset, buffer.length, `${assetPath}: GLB chunk alignment mismatch`);
	assert(chunks.length >= 1, `${assetPath}: GLB contains no chunks`);
	assert.equal(chunks[0].type, JSON_CHUNK, `${assetPath}: first GLB chunk must be JSON`);
	assert(chunks.filter((chunk) => chunk.type === JSON_CHUNK).length === 1, `${assetPath}: expected exactly one JSON chunk`);
	assert(chunks.filter((chunk) => chunk.type === BIN_CHUNK).length <= 1, `${assetPath}: expected at most one BIN chunk`);

	const jsonText = chunks[0].data.toString('utf8').replace(/[\u0000\u0020]+$/g, '');
	const gltf = JSON.parse(jsonText);
	assert.equal(String(gltf.asset?.version || ''), '2.0', `${assetPath}: glTF asset.version must be 2.0`);
	return { gltf, chunks };
}

function validateIndex(index, collection, label, assetPath) {
	assert(Number.isInteger(index), `${assetPath}: ${label} index must be an integer`);
	assert(index >= 0 && index < collection.length, `${assetPath}: ${label} index ${index} out of range`);
	return collection[index];
}

function validateTextureInfo(info, gltf, label, assetPath) {
	if (!info) return null;
	const textures = gltf.textures || [];
	const images = gltf.images || [];
	const texture = validateIndex(info.index, textures, `${label} texture`, assetPath);
	assert(Number.isInteger(texture.source), `${assetPath}: ${label} texture has no image source`);
	const image = validateIndex(texture.source, images, `${label} image`, assetPath);
	if (image.bufferView !== undefined) {
		validateIndex(image.bufferView, gltf.bufferViews || [], `${label} image bufferView`, assetPath);
	} else {
		assert(typeof image.uri === 'string' && image.uri.length > 0, `${assetPath}: ${label} image has neither bufferView nor uri`);
	}
	return { textureIndex: info.index, imageIndex: texture.source, mimeType: image.mimeType || null, uri: image.uri || null };
}

function inspectMaterial(material, materialIndex, gltf, assetPath) {
	const pbr = material?.pbrMetallicRoughness || {};
	const baseColorFactor = pbr.baseColorFactor || [1, 1, 1, 1];
	assert(Array.isArray(baseColorFactor) && baseColorFactor.length === 4, `${assetPath}: material ${materialIndex} invalid baseColorFactor`);
	assert(baseColorFactor.every((value) => Number.isFinite(value) && value >= 0), `${assetPath}: material ${materialIndex} non-finite base color`);
	const metallicFactor = pbr.metallicFactor ?? 1;
	const roughnessFactor = pbr.roughnessFactor ?? 1;
	assert(Number.isFinite(metallicFactor) && metallicFactor >= 0 && metallicFactor <= 1, `${assetPath}: material ${materialIndex} invalid metallicFactor`);
	assert(Number.isFinite(roughnessFactor) && roughnessFactor >= 0 && roughnessFactor <= 1, `${assetPath}: material ${materialIndex} invalid roughnessFactor`);

	const textures = {
		baseColor: validateTextureInfo(pbr.baseColorTexture, gltf, `material ${materialIndex} baseColor`, assetPath),
		metallicRoughness: validateTextureInfo(pbr.metallicRoughnessTexture, gltf, `material ${materialIndex} metallicRoughness`, assetPath),
		normal: validateTextureInfo(material.normalTexture, gltf, `material ${materialIndex} normal`, assetPath),
		emissive: validateTextureInfo(material.emissiveTexture, gltf, `material ${materialIndex} emissive`, assetPath),
		occlusion: validateTextureInfo(material.occlusionTexture, gltf, `material ${materialIndex} occlusion`, assetPath),
	};
	return {
		materialIndex,
		name: material?.name || '',
		metallicFactor,
		roughnessFactor,
		doubleSided: material?.doubleSided === true,
		alphaMode: material?.alphaMode || 'OPAQUE',
		textureChannels: Object.entries(textures).filter(([, texture]) => texture).map(([channel]) => channel),
	};
}

function inspectAsset(assetPath) {
	const absolute = path.join(ROOT, assetPath);
	assert(fs.existsSync(absolute), `${assetPath}: missing repository GLB`);
	const buffer = fs.readFileSync(absolute);
	assert(!buffer.subarray(0, 160).toString('utf8').startsWith('version https://git-lfs.github.com/spec'), `${assetPath}: still an LFS pointer`);
	const { gltf, chunks } = parseGlb(buffer, assetPath);
	const meshes = gltf.meshes || [];
	const materials = gltf.materials || [];
	const accessors = gltf.accessors || [];
	const bufferViews = gltf.bufferViews || [];
	const images = gltf.images || [];
	const textures = gltf.textures || [];
	const nodes = gltf.nodes || [];
	const scenes = gltf.scenes || [];
	assert(meshes.length > 0, `${assetPath}: GLB has no meshes`);
	assert(nodes.length > 0, `${assetPath}: GLB has no nodes`);
	assert(scenes.length > 0, `${assetPath}: GLB has no scenes`);
	assert(materials.length > 0, `${assetPath}: GLB has no authored materials`);
	assert(bufferViews.length > 0, `${assetPath}: GLB has no bufferViews`);
	assert(accessors.length > 0, `${assetPath}: GLB has no accessors`);

	const materialProof = materials.map((material, index) => inspectMaterial(material, index, gltf, assetPath));
	let primitiveCount = 0;
	let trianglePrimitiveCount = 0;
	let indexedPrimitiveCount = 0;
	const semanticSurfaces = [];
	const surfaceNames = [];

	meshes.forEach((mesh, meshIndex) => {
		assert(Array.isArray(mesh.primitives) && mesh.primitives.length > 0, `${assetPath}: mesh ${meshIndex} has no primitives`);
		mesh.primitives.forEach((primitive, primitiveIndex) => {
			primitiveCount++;
			const mode = primitive.mode ?? 4;
			if (mode === 4) trianglePrimitiveCount++;
			assert(primitive.attributes && Number.isInteger(primitive.attributes.POSITION), `${assetPath}: mesh ${meshIndex}/${primitiveIndex} missing POSITION`);
			validateIndex(primitive.attributes.POSITION, accessors, `mesh ${meshIndex}/${primitiveIndex} POSITION accessor`, assetPath);
			if (primitive.indices !== undefined) {
				validateIndex(primitive.indices, accessors, `mesh ${meshIndex}/${primitiveIndex} index accessor`, assetPath);
				indexedPrimitiveCount++;
			}
			let materialName = '';
			if (primitive.material !== undefined) {
				const material = validateIndex(primitive.material, materials, `mesh ${meshIndex}/${primitiveIndex} material`, assetPath);
				materialName = material?.name || '';
			}
			const meshName = mesh.name || '';
			const semantic = classifyPart({ meshName, materialName });
			const surface = { meshIndex, primitiveIndex, meshName, materialName, slot: semantic?.slot || null, matchedWord: semantic?.matchedWord || null };
			surfaceNames.push(surface);
			if (semantic?.slot?.startsWith('structure-')) semanticSurfaces.push(surface);
		});
	});

	assert(primitiveCount > 0, `${assetPath}: no render primitives`);
	assert(trianglePrimitiveCount > 0, `${assetPath}: no triangle primitives`);
	assert(indexedPrimitiveCount > 0, `${assetPath}: no indexed geometry`);
	for (const node of nodes) {
		if (node.mesh !== undefined) validateIndex(node.mesh, meshes, 'node mesh', assetPath);
	}
	for (const scene of scenes) {
		for (const nodeIndex of scene.nodes || []) validateIndex(nodeIndex, nodes, 'scene node', assetPath);
	}

	return {
		assetPath,
		bytes: buffer.length,
		chunkTypes: chunks.map((chunk) => chunk.type === JSON_CHUNK ? 'JSON' : chunk.type === BIN_CHUNK ? 'BIN' : `0x${chunk.type.toString(16)}`),
		meshCount: meshes.length,
		primitiveCount,
		trianglePrimitiveCount,
		indexedPrimitiveCount,
		nodeCount: nodes.length,
		materialCount: materials.length,
		textureCount: textures.length,
		imageCount: images.length,
		pbrMaterialCount: materials.filter((material) => material?.pbrMetallicRoughness).length,
		texturedMaterialCount: materialProof.filter((material) => material.textureChannels.length > 0).length,
		materialProof,
		semanticSurfaces,
		surfaceNames,
	};
}

const assetPaths = collectVillageAssets();
assert.equal(assetPaths.length, 7, `expected exactly seven hydrated residential GLB families, got ${assetPaths.length}`);
const inventory = assetPaths.map(inspectAsset);

assert.equal(new Set(inventory.map((entry) => entry.assetPath)).size, 7, 'village asset inventory must not contain duplicate paths');
assert(inventory.every((entry) => entry.bytes > 1024), 'hydrated GLBs must contain real payloads, not tiny placeholders');
assert(inventory.every((entry) => entry.chunkTypes[0] === 'JSON'), 'all village GLBs must begin with a JSON chunk');
assert(inventory.every((entry) => entry.meshCount > 0 && entry.primitiveCount > 0), 'all village GLBs must contain real render geometry');
assert(inventory.every((entry) => entry.materialCount > 0 && entry.pbrMaterialCount > 0), 'all village GLBs must carry glTF PBR material metadata');

const totalMeshes = inventory.reduce((sum, entry) => sum + entry.meshCount, 0);
const totalPrimitives = inventory.reduce((sum, entry) => sum + entry.primitiveCount, 0);
const totalMaterials = inventory.reduce((sum, entry) => sum + entry.materialCount, 0);
const totalImages = inventory.reduce((sum, entry) => sum + entry.imageCount, 0);
const totalSemanticSurfaces = inventory.reduce((sum, entry) => sum + entry.semanticSurfaces.length, 0);
const semanticSlots = [...new Set(inventory.flatMap((entry) => entry.semanticSurfaces.map((surface) => surface.slot)))].sort();

assert(totalMeshes >= 7, `expected at least one mesh per residential family, got ${totalMeshes}`);
assert(totalPrimitives >= totalMeshes, 'primitive inventory cannot be smaller than mesh inventory');
assert(totalMaterials >= 7, `expected authored material evidence across every residential family, got ${totalMaterials}`);

console.log('VILLAGE_GLB_ASSET_INVENTORY_PASS', JSON.stringify({
	assetCount: inventory.length,
	totalMeshes,
	totalPrimitives,
	totalMaterials,
	totalImages,
	totalSemanticSurfaces,
	semanticSlots,
	inventory,
}));
