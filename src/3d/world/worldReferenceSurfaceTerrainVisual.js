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
