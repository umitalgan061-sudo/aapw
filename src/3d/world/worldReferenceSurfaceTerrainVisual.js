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

export const WORLD_REFERENCE_SURFACE_VISUAL_POLICY = Object.freeze({
	id: 'owner-map-semantic-surface-visual-2026-08-11-v1',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	// Map-inspired matte palette. Macro placement comes from the source-derived mask; later pindex
	// polish may replace these flat swatches with PBR texture sets without changing classification.
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

/**
 * Applies canonical map semantics to one already-created terrain mesh.
 * @returns immutable per-mesh coverage stats used by visual/regression checks.
 */
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
	mesh.material.color.setHex(0xffffff);
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

/**
 * Applies the source-map semantic surface to a clipped canonical terrain window.
 * Roads/bridges/water are intentionally not traversed here; their existing ownership remains intact.
 */
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
// existing procedural terrain colors, then reuses the already-prepared Pindex-01..09 detail layers.
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

export const RUNTIME_PINDEX_TERRAIN_POLISH_POLICY = Object.freeze({
	id: 'terrain-polish-iteration-008-visible-pindex-runtime-2026-08-12-v1',
	semanticBlendBySurface: Object.freeze({ sea: 0.12, lake: 0.18, soil: 0.38, rock: 0.5, snow: 0.58 }),
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

/**
 * Blends owner-map semantics and prepared pindex detail into one live procedural terrain chunk.
 * Height/position attributes are read-only here; only vertex color + material roughness change.
 */
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
	mesh.material.color.setHex(0xffffff);
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

/** Installs the visible pindex polish onto shipped ChunkManager loads without replacing terrain generation. */
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
