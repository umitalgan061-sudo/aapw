/**
 * Owner-map semantic surface visual for the opt-in canonical full-reference terrain.
 *
 * Every terrain vertex is projected back to the exact 9000x7000 map canvas and classified by
 * `worldReferenceSurfacePindexes.js`, whose source SHA is the owner-supplied map.png. This keeps
 * macro land/water/rock/snow placement tied to the same canonical image while leaving canonical
 * road and stone-bridge geometry as overlays owned by their existing deterministic systems.
 *
 * Additive boundary: this module owns no terrain geometry and allocates no material. It only adds
 * a color attribute to canonical candidate meshes and enables vertex colors on their already-owned
 * MeshStandardMaterial. Existing disposal therefore remains the sole GPU-resource owner.
 * @module world/worldReferenceSurfaceTerrainVisual
 */

import * as THREE from 'three';
import { mapCanvasToNormalizedReference } from './worldReferenceAlignment.js';
import { plannedWorldXZToMapCanvas } from './worldReferenceMigrationPlan.js';
import {
	classifyReferenceBaseSurface,
	referencePindexFromNormalizedX,
} from './worldReferenceSurfacePindexes.js';
import { GEOGRAPHIC_REFERENCE_PALETTE, GEOGRAPHIC_REFERENCE_PALETTE_POLICY } from './geographicReferencePalette.js';

export const WORLD_REFERENCE_SURFACE_VISUAL_POLICY = Object.freeze({
	id: 'owner-map-semantic-surface-visual-2026-08-11-v1',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	colors: Object.freeze({
		sea: 0x294d5d,
		lake: 0x4f7f86,
		soil: 0x7d8758,
		rock: 0x756c60,
		snow: 0xd8dfdc,
	}),
	roughness: Object.freeze({
		sea: 0.92,
		lake: 0.88,
		soil: 0.96,
		rock: 0.99,
		snow: 0.9,
	}),
});

const COLOR_BY_SURFACE = Object.freeze(Object.fromEntries(
	Object.entries(WORLD_REFERENCE_SURFACE_VISUAL_POLICY.colors).map(([surface, hex]) => [surface, new THREE.Color(hex)]),
));

function assertTerrainMesh(mesh) {
	if (!mesh?.geometry?.getAttribute) throw new TypeError('canonical terrain mesh geometry is required');
	if (!mesh?.position) throw new TypeError('canonical terrain mesh position is required');
	if (Array.isArray(mesh.material) || !mesh.material?.isMeshStandardMaterial) {
		throw new TypeError('canonical terrain mesh must own one MeshStandardMaterial');
	}
}

function classifyWorldSurface(worldX, worldZ) {
	const mapPoint = plannedWorldXZToMapCanvas(worldX, worldZ);
	const normalized = mapCanvasToNormalizedReference(mapPoint.x, mapPoint.y);
	return Object.freeze({
		surface: classifyReferenceBaseSurface(normalized.x, normalized.y),
		pindex: referencePindexFromNormalizedX(normalized.x),
		normalizedX: normalized.x,
		normalizedY: normalized.y,
	});
}

export function applyReferenceSurfaceToTerrainMesh(mesh) {
	assertTerrainMesh(mesh);
	const position = mesh.geometry.getAttribute('position');
	if (!position) throw new TypeError('canonical terrain mesh position attribute is required');
	const colors = new Float32Array(position.count * 3);
	const counts = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };
	const pindexCounts = Array.from({ length: 10 }, () => 0);
	let roughnessSum = 0;

	for (let index = 0; index < position.count; index += 1) {
		const worldX = mesh.position.x + position.getX(index);
		const worldZ = mesh.position.z + position.getZ(index);
		const classification = classifyWorldSurface(worldX, worldZ);
		const color = COLOR_BY_SURFACE[classification.surface];
		if (!color) throw new Error(`missing canonical surface color: ${classification.surface}`);
		counts[classification.surface] += 1;
		pindexCounts[classification.pindex - 1] += 1;
		roughnessSum += WORLD_REFERENCE_SURFACE_VISUAL_POLICY.roughness[classification.surface];
		colors[index * 3] = color.r;
		colors[index * 3 + 1] = color.g;
		colors[index * 3 + 2] = color.b;
	}

	mesh.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	mesh.material.vertexColors = true;
	mesh.material.color.setScalar(mesh.material.userData?.terrainDetailGain ?? 1);
	mesh.material.roughness = roughnessSum / position.count;
	mesh.material.metalness = 0;
	mesh.material.needsUpdate = true;
	const summary = Object.freeze({
		vertexCount: position.count,
		counts: Object.freeze({ ...counts }),
		pindexVertexCounts: Object.freeze([...pindexCounts]),
		averageRoughness: mesh.material.roughness,
	});
	mesh.userData.run273CanonicalMapSurface = summary;
	return summary;
}

export function applyReferenceSurfaceToTerrainGroup(terrainGroup) {
	if (!terrainGroup?.children || !Array.isArray(terrainGroup.children)) {
		throw new TypeError('canonical terrain group is required');
	}
	const totals = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };
	const pindexVertexCounts = Array.from({ length: 10 }, () => 0);
	let vertexCount = 0;
	for (const mesh of terrainGroup.children) {
		const summary = applyReferenceSurfaceToTerrainMesh(mesh);
		vertexCount += summary.vertexCount;
		for (const surface of Object.keys(totals)) totals[surface] += summary.counts[surface];
		for (let index = 0; index < pindexVertexCounts.length; index += 1) {
			pindexVertexCounts[index] += summary.pindexVertexCounts[index];
		}
	}
	const summary = Object.freeze({
		policyId: WORLD_REFERENCE_SURFACE_VISUAL_POLICY.id,
		sourceMapSha256: WORLD_REFERENCE_SURFACE_VISUAL_POLICY.sourceMapSha256,
		meshCount: terrainGroup.children.length,
		vertexCount,
		counts: Object.freeze({ ...totals }),
		pindexVertexCounts: Object.freeze([...pindexVertexCounts]),
	});
	terrainGroup.userData.run273CanonicalMapSurface = summary;
	return summary;
}

// Terrain Polish Iteration #08 — deliberate shipped-game visual change.
// The historical canonical-dev surface above remains intact. This additive adapter projects the
// current cropped runtime world back onto the same owner-map mask, blends those semantics into the
// existing procedural terrain colors, then reuses the prepared Pindex-01..10 detail layers.
// Geometry/height stays untouched in this iteration, so settlement, road, river and physics safety
// contracts remain on their proven sampler while the player-visible ground finally changes.
import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { mapCanvasToPlannedWorldXZ } from './worldReferenceMigrationPlan.js';
import { ChunkManager } from './chunkManager.js';
import { applyPindex01DetailToTerrainMesh } from './worldReferencePindex01Detail.js';
import { applyPindex02DetailToTerrainMesh } from './worldReferencePindex02Detail.js';
import { applyPindex03DetailToTerrainMesh } from './worldReferencePindex03Detail.js';
import { applyPindex04DetailToTerrainMesh } from './worldReferencePindex04Detail.js';
import { applyPindex05DetailToTerrainMesh } from './worldReferencePindex05Detail.js';
import { applyPindex06DetailToTerrainMesh } from './worldReferencePindex06Detail.js';
import { applyPindex07DetailToTerrainMesh } from './worldReferencePindex07Detail.js';
import { applyPindex08DetailToTerrainMesh } from './worldReferencePindex08Detail.js';
import { applyPindex09DetailToTerrainMesh } from './worldReferencePindex09Detail.js';
import { applyPindex10DetailToTerrainMesh } from './worldReferencePindex10Detail.js';

export const RUNTIME_PINDEX_TERRAIN_POLISH_POLICY = Object.freeze({
	id: 'terrain-polish-iteration-008-visible-pindex-runtime-2026-08-12-v1',
	semanticBlendBySurface: Object.freeze({ sea: 0.10, lake: 0.14, soil: 0.12, rock: 0.14, snow: 0.16 }),
	wetLowHeightBoost: 0.18,
	wetHeightFadeMeters: 18,
	roughnessBlend: 0.65,
});

const RUNTIME_PINDEX_DETAIL_APPLIERS = Object.freeze({
	1: applyPindex01DetailToTerrainMesh,
	2: applyPindex02DetailToTerrainMesh,
	3: applyPindex03DetailToTerrainMesh,
	4: applyPindex04DetailToTerrainMesh,
	5: applyPindex05DetailToTerrainMesh,
	6: applyPindex06DetailToTerrainMesh,
	7: applyPindex07DetailToTerrainMesh,
	8: applyPindex08DetailToTerrainMesh,
	9: applyPindex09DetailToTerrainMesh,
	10: applyPindex10DetailToTerrainMesh,
});

function currentWorldReferenceSample(worldX, worldZ) {
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const rawMapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX;
	const rawMapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	const mapX = THREE.MathUtils.clamp(rawMapX, 0, WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits);
	const mapY = THREE.MathUtils.clamp(rawMapY, 0, WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits);
	const normalized = mapCanvasToNormalizedReference(mapX, mapY);
	const planned = mapCanvasToPlannedWorldXZ(mapX, mapY);
	return Object.freeze({
		surface: classifyReferenceBaseSurface(normalized.x, normalized.y),
		pindex: referencePindexFromNormalizedX(normalized.x),
		plannedX: planned.x,
		plannedZ: planned.z,
	});
}

function runtimeSemanticBlend(surface, vertexHeightMeters) {
	const base = RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.semanticBlendBySurface[surface] ?? 0;
	if (surface !== 'sea' && surface !== 'lake') return base;
	const heightAboveWater = Math.max(0, vertexHeightMeters - WORLD_DEFAULTS.WATER_LEVEL_METERS);
	const lowHeightWeight = 1 - THREE.MathUtils.clamp(
		heightAboveWater / RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.wetHeightFadeMeters,
		0,
		1,
	);
	return THREE.MathUtils.clamp(
		base + lowHeightWeight * RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.wetLowHeightBoost,
		0,
		0.7,
	);
}

export function applyRuntimePindexTerrainPolishToMesh(mesh) {
	assertTerrainMesh(mesh);
	const prior = mesh.userData.runtimePindexTerrainPolish;
	if (prior?.policyId === RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.id) return prior;
	const position = mesh.geometry.getAttribute('position');
	const color = mesh.geometry.getAttribute('color');
	if (!position || !color) throw new TypeError('runtime terrain position+color attributes are required');
	const plannedX = new Float64Array(position.count);
	const plannedZ = new Float64Array(position.count);
	const activePindexes = new Set();
	const counts = { sea: 0, lake: 0, soil: 0, rock: 0, snow: 0 };
	const sourceColor = new THREE.Color();
	let roughnessSum = 0;
	let changedVertices = 0;

	for (let index = 0; index < position.count; index += 1) {
		const worldX = mesh.position.x + position.getX(index);
		const worldZ = mesh.position.z + position.getZ(index);
		const sample = currentWorldReferenceSample(worldX, worldZ);
		plannedX[index] = sample.plannedX;
		plannedZ[index] = sample.plannedZ;
		activePindexes.add(sample.pindex);
		counts[sample.surface] += 1;
		roughnessSum += WORLD_REFERENCE_SURFACE_VISUAL_POLICY.roughness[sample.surface];
		const beforeR = color.getX(index);
		const beforeG = color.getY(index);
		const beforeB = color.getZ(index);
		sourceColor.setRGB(beforeR, beforeG, beforeB);
		sourceColor.lerp(COLOR_BY_SURFACE[sample.surface], runtimeSemanticBlend(sample.surface, position.getY(index)));
		color.setXYZ(index, sourceColor.r, sourceColor.g, sourceColor.b);
		if (sourceColor.r !== beforeR || sourceColor.g !== beforeG || sourceColor.b !== beforeB) changedVertices += 1;
	}
	color.needsUpdate = true;

	const plannedPosition = Object.freeze({
		count: position.count,
		getX: (index) => plannedX[index],
		getZ: (index) => plannedZ[index],
	});
	const proxyGeometry = Object.freeze({
		getAttribute: (name) => name === 'position' ? plannedPosition : mesh.geometry.getAttribute(name),
	});
	const proxyMesh = {
		geometry: proxyGeometry,
		position: Object.freeze({ x: 0, z: 0 }),
		userData: {},
	};
	const detailSummaries = [];
	let detailTouchedVertices = 0;
	for (const pindex of [...activePindexes].sort((a, b) => a - b)) {
		const applyDetail = RUNTIME_PINDEX_DETAIL_APPLIERS[pindex];
		if (!applyDetail) continue;
		const detail = applyDetail(proxyMesh);
		detailSummaries.push(detail);
		detailTouchedVertices += detail.touchedVertices;
	}

	mesh.material.vertexColors = true;
	mesh.material.color.setScalar(mesh.material.userData?.terrainDetailGain ?? 1);
	mesh.material.roughness = THREE.MathUtils.lerp(
		mesh.material.roughness,
		roughnessSum / position.count,
		RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.roughnessBlend,
	);
	mesh.material.metalness = 0;
	mesh.material.needsUpdate = true;
	const summary = Object.freeze({
		policyId: RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.id,
		vertexCount: position.count,
		changedVertices,
		detailTouchedVertices,
		activePindexes: Object.freeze([...activePindexes].sort((a, b) => a - b)),
		counts: Object.freeze({ ...counts }),
		averageRoughness: mesh.material.roughness,
		detailPolicyIds: Object.freeze(detailSummaries.map((detail) => detail.policyId)),
	});
	mesh.userData.runtimePindexTerrainPolish = summary;
	return summary;
}

const RUNTIME_PINDEX_INSTALL_FLAG = Symbol.for('westeros.runtime-pindex-terrain-polish.iteration-008');

export function installRuntimePindexTerrainPolish() {
	const prototype = ChunkManager.prototype;
	if (prototype[RUNTIME_PINDEX_INSTALL_FLAG]) return prototype[RUNTIME_PINDEX_INSTALL_FLAG];
	const loadChunkBeforePindexPolish = prototype.loadChunk;
	const streamTowardsBeforePindexPolish = prototype.streamTowards;

	prototype.loadChunk = function loadChunkWithRuntimePindexPolish(chunkX, chunkZ) {
		const mesh = loadChunkBeforePindexPolish.call(this, chunkX, chunkZ);
		applyRuntimePindexTerrainPolishToMesh(mesh);
		return mesh;
	};
	prototype.streamTowards = function streamTowardsWithRuntimePindexPolish(centerChunkX, centerChunkZ, radius) {
		const result = streamTowardsBeforePindexPolish.call(this, centerChunkX, centerChunkZ, radius);
		for (const mesh of this.loaded.values()) applyRuntimePindexTerrainPolishToMesh(mesh);
		return result;
	};
	const installation = Object.freeze({ policyId: RUNTIME_PINDEX_TERRAIN_POLISH_POLICY.id, installed: true });
	Object.defineProperty(prototype, RUNTIME_PINDEX_INSTALL_FLAG, { value: installation, configurable: false });
	return installation;
}

// Pindex Quality V2 remains the canonical atlas owner; the additions below only make its blend
// respond to the real rendered surface orientation instead of laying a flat colour sheet over it.
import { REFERENCE_PINDEX_QUALITY_V2_POLICY, sampleReferencePindexQualityV2 } from './worldReferenceSurfacePindexes.js';

export const RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY = Object.freeze({
	id: 'terrain-pindex-quality-v2-runtime-2026-08-31-v3-multiscale-roughness',
	atlasWidth: 192,
	atlasHeight: 128,
	qualityBlend: 0.34,
	biomeBlendMax: 0.62,
	reliefRockBlend: 0.38,
	elevationRockBlend: 0.28,
	roughnessBlend: 0.52,
	shaderColorMicroVariation: 0.055,
	shaderRoughnessMicroVariation: 0.05,
	roughnessDetailRevision: 'v2-rotated-incommensurate-multiscale',
	roughnessDetailFrequencies: Object.freeze([0.033, 0.0187, 0.0079]),
	naturalTransitionRevision: 'v1-slope-aspect-shelter',
	slopeAwareAtlasIntegration: true,
	aspectWeathering: true,
	shelteredMoisture: true,
	referencePalettePolicyId: GEOGRAPHIC_REFERENCE_PALETTE_POLICY.id,
});

const PINDEX_QUALITY_V2_SURFACE_COLORS = Object.freeze({
	soil: new THREE.Color(0x718153), rock: new THREE.Color(0x746d64), snow: new THREE.Color(0xd9e2df),
	sea: new THREE.Color(0x284f63), lake: new THREE.Color(0x4d7e80),
});
const PINDEX_QUALITY_V2_SURFACE_ROUGHNESS = Object.freeze({ sea: 0.86, lake: 0.83, soil: 0.94, rock: 0.985, snow: 0.89 });
const PINDEX_QUALITY_V2_BIOME_COLORS = Object.freeze({
	snow: new THREE.Color(0xcfdad8), 'cold-grassland': new THREE.Color(0x63765a), marsh: new THREE.Color(0x526c5b),
	mountain: new THREE.Color(0x6e6962), 'rocky-hills': new THREE.Color(0x756d5b), 'lush-grassland': new THREE.Color(0x6f8d51),
	desert: new THREE.Color(0x9b7b50), 'temperate-coast': new THREE.Color(0x67805b), steppe: new THREE.Color(0x878250),
	arid: new THREE.Color(0x897258), jungle: new THREE.Color(0x426b49),
});
const PINDEX_QUALITY_V2_ROCK_COLOR = new THREE.Color(0x6b6862);
const PINDEX_QUALITY_V2_SNOW_COLOR = new THREE.Color(0xdce4e2);
const PINDEX_QUALITY_V2_GRANITE_SHADOW = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.terrain.graniteShadow);
const PINDEX_QUALITY_V2_GRANITE_SUNLIT = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.terrain.graniteSunlit);
const PINDEX_QUALITY_V2_BASALT_WET = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.terrain.basaltWet);
const PINDEX_QUALITY_V2_MOSS_SHADOW = new THREE.Color(GEOGRAPHIC_REFERENCE_PALETTE.terrain.mossShadow);

function runtimePindexQualityNormalized(worldX, worldZ) {
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	return Object.freeze({
		x: THREE.MathUtils.clamp((worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits, 0, 1),
		y: THREE.MathUtils.clamp((worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits, 0, 1),
	});
}

function buildRuntimePindexQualityV2Atlas() {
	const { atlasWidth: width, atlasHeight: height } = RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY;
	const colorBytes = new Uint8Array(width * height * 4);
	const dataBytes = new Uint8Array(width * height * 4);
	const surfaceColor = new THREE.Color();
	const biomeColor = new THREE.Color();
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			const sample = sampleReferencePindexQualityV2(x / (width - 1), y / (height - 1));
			surfaceColor.setRGB(0, 0, 0);
			let roughness = 0;
			for (const [surface, weight] of Object.entries(sample.surfaceWeights)) {
				const color = PINDEX_QUALITY_V2_SURFACE_COLORS[surface];
				surfaceColor.r += color.r * weight; surfaceColor.g += color.g * weight; surfaceColor.b += color.b * weight;
				roughness += PINDEX_QUALITY_V2_SURFACE_ROUGHNESS[surface] * weight;
			}
			const dryWeight = sample.surfaceWeights.soil + sample.surfaceWeights.rock + sample.surfaceWeights.snow;
			biomeColor.setRGB(0, 0, 0);
			let biomeWeight = 0;
			for (const [kind, weight] of Object.entries(sample.biomeKindWeights)) {
				const color = PINDEX_QUALITY_V2_BIOME_COLORS[kind];
				if (!color || weight <= 0) continue;
				biomeColor.r += color.r * weight; biomeColor.g += color.g * weight; biomeColor.b += color.b * weight; biomeWeight += weight;
			}
			if (biomeWeight > 0 && dryWeight > 0.15) {
				biomeColor.multiplyScalar(1 / biomeWeight);
				surfaceColor.lerp(biomeColor, THREE.MathUtils.clamp(sample.biomeInfluence * dryWeight * RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.biomeBlendMax, 0, RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.biomeBlendMax));
			}
			const offset = (y * width + x) * 4;
			colorBytes[offset] = Math.round(THREE.MathUtils.clamp(surfaceColor.r, 0, 1) * 255);
			colorBytes[offset + 1] = Math.round(THREE.MathUtils.clamp(surfaceColor.g, 0, 1) * 255);
			colorBytes[offset + 2] = Math.round(THREE.MathUtils.clamp(surfaceColor.b, 0, 1) * 255);
			colorBytes[offset + 3] = Math.round(THREE.MathUtils.clamp(dryWeight, 0, 1) * 255);
			dataBytes[offset] = Math.round(THREE.MathUtils.clamp(sample.reliefInfluence, 0, 1) * 255);
			dataBytes[offset + 1] = Math.round(THREE.MathUtils.clamp(roughness, 0, 1) * 255);
			dataBytes[offset + 2] = Math.round(THREE.MathUtils.clamp(sample.boundaryBlend, 0, 1) * 255);
			dataBytes[offset + 3] = Math.round(THREE.MathUtils.clamp(sample.microAmplitude / 0.05, 0, 1) * 255);
		}
	}
	const makeTexture = (bytes) => {
		const texture = new THREE.DataTexture(bytes, width, height, THREE.RGBAFormat, THREE.UnsignedByteType);
		texture.minFilter = THREE.LinearFilter; texture.magFilter = THREE.LinearFilter;
		texture.wrapS = THREE.ClampToEdgeWrapping; texture.wrapT = THREE.ClampToEdgeWrapping;
		texture.generateMipmaps = false; texture.needsUpdate = true;
		return texture;
	};
	return Object.freeze({ color: makeTexture(colorBytes), data: makeTexture(dataBytes), width, height });
}

const RUNTIME_PINDEX_QUALITY_V2_ATLAS = buildRuntimePindexQualityV2Atlas();

function buildRuntimePindexQualityV2DetailAtlas() {
	const size = 64;
	const bytes = new Uint8Array(size * size * 4);
	const hashByte = (x, y, channel) => {
		let value = Math.imul(x + 17 + channel * 131, 374761393) ^ Math.imul(y + 29 + channel * 197, 668265263);
		value = Math.imul(value ^ (value >>> 13), 1274126177);
		return (value ^ (value >>> 16)) & 255;
	};
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const offset = (y * size + x) * 4;
			bytes[offset] = hashByte(x, y, 0);
			bytes[offset + 1] = hashByte(x, y, 1);
			bytes[offset + 2] = hashByte(x, y, 2);
			bytes[offset + 3] = 255;
		}
	}
	const texture = new THREE.DataTexture(bytes, size, size, THREE.RGBAFormat, THREE.UnsignedByteType);
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.generateMipmaps = false;
	texture.needsUpdate = true;
	return texture;
}

const RUNTIME_PINDEX_QUALITY_V2_DETAIL_ATLAS = buildRuntimePindexQualityV2DetailAtlas();

function installRuntimePindexQualityV2Shader(material) {
	if (material.userData?.runtimePindexQualityV2Shader === RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id) return false;
	const previousCompile = material.onBeforeCompile;
	const previousCacheKey = material.customProgramCacheKey.bind(material);
	const centerX = ((WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
	const centerY = ((WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5) / WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
	const scaleX = 1 / (WORLD_SCALE.METERS_PER_MAP_UNIT * WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits);
	const scaleY = 1 / (WORLD_SCALE.METERS_PER_MAP_UNIT * WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits);
	material.onBeforeCompile = function onBeforeCompilePindexQualityV2(shader, renderer) {
		previousCompile.call(this, shader, renderer);
		shader.uniforms.pindexQualityColorAtlas = { value: RUNTIME_PINDEX_QUALITY_V2_ATLAS.color };
		shader.uniforms.pindexQualityDataAtlas = { value: RUNTIME_PINDEX_QUALITY_V2_ATLAS.data };
		shader.uniforms.pindexQualityDetailAtlas = { value: RUNTIME_PINDEX_QUALITY_V2_DETAIL_ATLAS };
		shader.uniforms.pindexQualityMapTransform = { value: new THREE.Vector4(scaleX, scaleY, centerX, centerY) };
		shader.vertexShader = shader.vertexShader
			.replace('#include <common>', '#include <common>\nvarying vec3 vPindexQualityWorldPosition;')
			.replace('#include <begin_vertex>', '#include <begin_vertex>\nvPindexQualityWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
		shader.fragmentShader = shader.fragmentShader
			.replace('#include <common>', '#include <common>\nuniform sampler2D pindexQualityColorAtlas;\nuniform sampler2D pindexQualityDataAtlas;\nuniform sampler2D pindexQualityDetailAtlas;\nuniform vec4 pindexQualityMapTransform;\nvarying vec3 vPindexQualityWorldPosition;')
			.replace('#include <color_fragment>', `#include <color_fragment>\nvec3 pindexGeoDx=dFdx(vPindexQualityWorldPosition);\nvec3 pindexGeoDy=dFdy(vPindexQualityWorldPosition);\nvec3 pindexGeoNormal=normalize(cross(pindexGeoDy,pindexGeoDx));\npindexGeoNormal*=pindexGeoNormal.y<0.0?-1.0:1.0;\nfloat pindexGeoSlope=1.0-clamp(abs(pindexGeoNormal.y),0.0,1.0);\nvec2 pindexGeoHorizontal=pindexGeoNormal.xz/max(length(pindexGeoNormal.xz),0.0001);\nfloat pindexGeoAspect=dot(pindexGeoHorizontal,normalize(vec2(0.64,-0.77)))*0.5+0.5;\nvec2 pindexGeoMacroUv=vPindexQualityWorldPosition.xz*0.00073+vec2(7.3,-11.9);\nvec2 pindexGeoMacroRotated=vec2(pindexGeoMacroUv.x*0.73-pindexGeoMacroUv.y*0.68,pindexGeoMacroUv.x*0.68+pindexGeoMacroUv.y*0.73)*1.61+vec2(-3.7,8.1);\nfloat pindexGeoMacro=texture2D(pindexQualityDetailAtlas,pindexGeoMacroUv).g*0.62+texture2D(pindexQualityDetailAtlas,pindexGeoMacroRotated).b*0.38;\nfloat pindexGeoCliff=smoothstep(0.24,0.70,pindexGeoSlope)*pindexQualityDry;\nfloat pindexGeoShelter=clamp((1.0-pindexGeoAspect)*0.58+(1.0-pindexGeoMacro)*0.42,0.0,1.0);\nfloat pindexGeoWetShelter=pindexGeoCliff*smoothstep(0.56,0.84,pindexGeoShelter);\nfloat pindexGeoWeatheredFace=pindexGeoCliff*(1.0-pindexGeoWetShelter)*smoothstep(0.40,0.78,pindexGeoAspect);\nfloat pindexGeoMossPocket=(1.0-smoothstep(0.58,0.86,pindexGeoSlope))*pindexQualityDry*smoothstep(0.62,0.88,pindexGeoShelter)*smoothstep(0.38,0.74,pindexGeoMacro);\nvec3 pindexGeoShadowRock=vec3(${PINDEX_QUALITY_V2_GRANITE_SHADOW.r.toFixed(6)},${PINDEX_QUALITY_V2_GRANITE_SHADOW.g.toFixed(6)},${PINDEX_QUALITY_V2_GRANITE_SHADOW.b.toFixed(6)});\nvec3 pindexGeoSunRock=vec3(${PINDEX_QUALITY_V2_GRANITE_SUNLIT.r.toFixed(6)},${PINDEX_QUALITY_V2_GRANITE_SUNLIT.g.toFixed(6)},${PINDEX_QUALITY_V2_GRANITE_SUNLIT.b.toFixed(6)});\nvec3 pindexGeoWetRock=vec3(${PINDEX_QUALITY_V2_BASALT_WET.r.toFixed(6)},${PINDEX_QUALITY_V2_BASALT_WET.g.toFixed(6)},${PINDEX_QUALITY_V2_BASALT_WET.b.toFixed(6)});\nvec3 pindexGeoMoss=vec3(${PINDEX_QUALITY_V2_MOSS_SHADOW.r.toFixed(6)},${PINDEX_QUALITY_V2_MOSS_SHADOW.g.toFixed(6)},${PINDEX_QUALITY_V2_MOSS_SHADOW.b.toFixed(6)});\npindexQualityColor=mix(pindexQualityColor,mix(pindexGeoShadowRock,pindexGeoSunRock,pindexGeoAspect),pindexGeoCliff*0.30);\npindexQualityColor=mix(pindexQualityColor,pindexGeoWetRock,pindexGeoWetShelter*0.34);\npindexQualityColor=mix(pindexQualityColor,pindexGeoSunRock,pindexGeoWeatheredFace*0.16);\npindexQualityColor=mix(pindexQualityColor,pindexGeoMoss,pindexGeoMossPocket*0.18);`)
			.replace('#include <color_fragment>', `#include <color_fragment>\nvec2 pindexQualityUv=clamp(vPindexQualityWorldPosition.xz*pindexQualityMapTransform.xy+pindexQualityMapTransform.zw,vec2(0.0),vec2(1.0));\nvec4 pindexQualityAtlasColor=texture2D(pindexQualityColorAtlas,pindexQualityUv);\nvec4 pindexQualityAtlasData=texture2D(pindexQualityDataAtlas,pindexQualityUv);\nvec3 pindexQualityColor=pindexQualityAtlasColor.rgb;\nfloat pindexQualityRelief=pindexQualityAtlasData.r;\nfloat pindexQualityDry=pindexQualityAtlasColor.a;\nfloat pindexQualityHeightRock=smoothstep(22.0,82.0,vPindexQualityWorldPosition.y)*pindexQualityDry;\npindexQualityColor=mix(pindexQualityColor,vec3(${PINDEX_QUALITY_V2_ROCK_COLOR.r.toFixed(6)},${PINDEX_QUALITY_V2_ROCK_COLOR.g.toFixed(6)},${PINDEX_QUALITY_V2_ROCK_COLOR.b.toFixed(6)}),pindexQualityRelief*pindexQualityDry*${RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.reliefRockBlend.toFixed(3)});\npindexQualityColor=mix(pindexQualityColor,vec3(${PINDEX_QUALITY_V2_ROCK_COLOR.r.toFixed(6)},${PINDEX_QUALITY_V2_ROCK_COLOR.g.toFixed(6)},${PINDEX_QUALITY_V2_ROCK_COLOR.b.toFixed(6)}),pindexQualityHeightRock*${RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.elevationRockBlend.toFixed(3)});\nfloat pindexQualityNorthSnow=pindexQualityRelief*(1.0-smoothstep(0.08,0.34,pindexQualityUv.y))*smoothstep(16.0,58.0,vPindexQualityWorldPosition.y);\npindexQualityColor=mix(pindexQualityColor,vec3(${PINDEX_QUALITY_V2_SNOW_COLOR.r.toFixed(6)},${PINDEX_QUALITY_V2_SNOW_COLOR.g.toFixed(6)},${PINDEX_QUALITY_V2_SNOW_COLOR.b.toFixed(6)}),pindexQualityNorthSnow*0.42);\nvec2 pindexQualityDetailUv=vPindexQualityWorldPosition.xz*0.021;\nvec4 pindexQualityNoiseA=texture2D(pindexQualityDetailAtlas,pindexQualityDetailUv);\nvec2 pindexQualityRotatedUv=vec2(pindexQualityDetailUv.x*0.8-pindexQualityDetailUv.y*0.6,pindexQualityDetailUv.x*0.6+pindexQualityDetailUv.y*0.8)*2.73+vec2(0.37,0.19);\nvec4 pindexQualityNoiseB=texture2D(pindexQualityDetailAtlas,pindexQualityRotatedUv);\nfloat pindexQualityGrain=(pindexQualityNoiseA.r*2.0-1.0)*0.64+(pindexQualityNoiseB.g*2.0-1.0)*0.36;\npindexQualityColor*=1.0+pindexQualityGrain*mix(0.025,${RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.shaderColorMicroVariation.toFixed(3)},pindexQualityAtlasData.a);\ndiffuseColor.rgb=mix(diffuseColor.rgb,pindexQualityColor,${RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.qualityBlend.toFixed(3)});`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor=clamp(roughnessFactor-pindexGeoWetShelter*0.11+pindexGeoWeatheredFace*0.045+pindexGeoMossPocket*0.035,0.04,1.0);`)
			.replace('#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\nroughnessFactor=mix(roughnessFactor,pindexQualityAtlasData.g,${RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.roughnessBlend.toFixed(3)});\nvec2 pindexQualityRoughUvA=vPindexQualityWorldPosition.xz*0.033+vec2(0.11,0.57);\nvec2 pindexQualityRoughFrameB=vec2(vPindexQualityWorldPosition.x*0.73-vPindexQualityWorldPosition.z*0.68,vPindexQualityWorldPosition.x*0.68+vPindexQualityWorldPosition.z*0.73);\nvec2 pindexQualityRoughUvB=pindexQualityRoughFrameB*0.0187+vec2(-0.43,0.29);\nvec2 pindexQualityRoughFrameC=vec2(vPindexQualityWorldPosition.x*0.51+vPindexQualityWorldPosition.z*0.86,-vPindexQualityWorldPosition.x*0.86+vPindexQualityWorldPosition.z*0.51);\nvec2 pindexQualityRoughUvC=pindexQualityRoughFrameC*0.0079+vec2(0.67,-0.37);\nfloat pindexQualityRoughA=texture2D(pindexQualityDetailAtlas,pindexQualityRoughUvA).b*2.0-1.0;\nfloat pindexQualityRoughB=texture2D(pindexQualityDetailAtlas,pindexQualityRoughUvB).r*2.0-1.0;\nfloat pindexQualityRoughC=texture2D(pindexQualityDetailAtlas,pindexQualityRoughUvC).g*2.0-1.0;\nfloat pindexQualityRoughNoise=pindexQualityRoughA*0.46+pindexQualityRoughB*0.34+pindexQualityRoughC*0.20;\nroughnessFactor=clamp(roughnessFactor+pindexQualityRoughNoise*${RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.shaderRoughnessMicroVariation.toFixed(3)},0.04,1.0);`);
	};
	material.customProgramCacheKey = () => `${previousCacheKey()}|${RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id}`;
	material.userData.runtimePindexQualityV2Shader = RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id;
	material.needsUpdate = true;
	return true;
}

export function applyRuntimePindexTerrainQualityV2ToMesh(mesh) {
	assertTerrainMesh(mesh);
	const prior = mesh.userData.runtimePindexTerrainQualityV2;
	if (prior?.policyId === RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id) return prior;
	const iteration008 = applyRuntimePindexTerrainPolishToMesh(mesh);
	installRuntimePindexQualityV2Shader(mesh.material);
	const center = runtimePindexQualityNormalized(mesh.position.x, mesh.position.z);
	const sample = sampleReferencePindexQualityV2(center.x, center.y);
	const activeBiomeKinds = Object.freeze(Object.entries(sample.biomeKindWeights).filter(([, weight]) => weight > 0.02).map(([kind]) => kind).sort());
	const summary = Object.freeze({
		policyId: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id,
		samplingPolicyId: REFERENCE_PINDEX_QUALITY_V2_POLICY.id,
		vertexCount: iteration008.vertexCount,
		changedVertices: iteration008.vertexCount,
		activeBiomeKinds,
		centerPindex: sample.pindex,
		atlasResolution: Object.freeze([RUNTIME_PINDEX_QUALITY_V2_ATLAS.width, RUNTIME_PINDEX_QUALITY_V2_ATLAS.height]),
		shaderDetail: true,
		cpuVertexPassesAdded: 0,
	});
	mesh.userData.runtimePindexTerrainQualityV2 = summary;
	return summary;
}

const installRuntimePindexTerrainPolishIteration008 = installRuntimePindexTerrainPolish;
const RUNTIME_PINDEX_QUALITY_V2_INSTALL_FLAG = Symbol.for('westeros.runtime-pindex-terrain-quality-v2.2026-08-31-v3-multiscale-roughness');

installRuntimePindexTerrainPolish = function installRuntimePindexTerrainPolishQualityV2() {
	const iteration008 = installRuntimePindexTerrainPolishIteration008();
	const prototype = ChunkManager.prototype;
	if (prototype[RUNTIME_PINDEX_QUALITY_V2_INSTALL_FLAG]) return prototype[RUNTIME_PINDEX_QUALITY_V2_INSTALL_FLAG];
	const loadChunkBeforeQualityV2 = prototype.loadChunk;
	const streamTowardsBeforeQualityV2 = prototype.streamTowards;
	prototype.loadChunk = function loadChunkWithPindexQualityV2(chunkX, chunkZ) {
		const mesh = loadChunkBeforeQualityV2.call(this, chunkX, chunkZ);
		applyRuntimePindexTerrainQualityV2ToMesh(mesh);
		return mesh;
	};
	prototype.streamTowards = function streamTowardsWithPindexQualityV2(centerChunkX, centerChunkZ, radius) {
		const result = streamTowardsBeforeQualityV2.call(this, centerChunkX, centerChunkZ, radius);
		for (const mesh of this.loaded.values()) applyRuntimePindexTerrainQualityV2ToMesh(mesh);
		return result;
	};
	const installation = Object.freeze({ policyId: RUNTIME_PINDEX_TERRAIN_QUALITY_V2_POLICY.id, previousPolicyId: iteration008.policyId, installed: true });
	Object.defineProperty(prototype, RUNTIME_PINDEX_QUALITY_V2_INSTALL_FLAG, { value: installation, configurable: false });
	return installation;
};
