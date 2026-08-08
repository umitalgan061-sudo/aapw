/**
 * Run 194 shadow-only migration harness for canonical scene-window ownership.
 *
 * This module wraps the validated Run193 scene adapter without changing it. It constrains terrain
 * residency to the planned 27x21 full-reference chunk grid and exposes deterministic ownership
 * helpers so world-edge behavior and all bridge-local windows can be qualified before any live
 * scene/chunk/physics migration is considered.
 * @module world/worldReferenceSceneShadowMigrationHarness
 */

import {
	CANONICAL_SCENE_SHADOW_POLICY,
	createCanonicalSceneShadowWindow,
	disposeCanonicalSceneShadowWindow,
	summarizeCanonicalSceneShadowWindow,
} from './worldReferenceSceneShadowAdapter.js';
import { FULL_REFERENCE_WORLD_MIGRATION_PLAN } from './worldReferenceMigrationPlan.js';
import { disposeCanonicalTerrainShadowChunk } from './worldReferenceChunkShadow.js';

export const CANONICAL_SCENE_SHADOW_MIGRATION_POLICY = Object.freeze({
	key: 'run194-canonical-scene-shadow-migration-harness-v1',
	gridColumns: FULL_REFERENCE_WORLD_MIGRATION_PLAN.gridColumns,
	gridRows: FULL_REFERENCE_WORLD_MIGRATION_PLAN.gridRows,
	chunkSizeMeters: FULL_REFERENCE_WORLD_MIGRATION_PLAN.chunkSizeMeters,
});

function assertFinite(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function centeredChunkRange(count) {
	if (!Number.isInteger(count) || count <= 0) throw new RangeError('chunk count must be a positive integer');
	const min = -Math.floor(count / 2);
	return Object.freeze({ min, max: min + count - 1, count });
}

export function getCanonicalSceneShadowChunkBounds() {
	return Object.freeze({
		x: centeredChunkRange(CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridColumns),
		z: centeredChunkRange(CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.gridRows),
	});
}

export function isCanonicalSceneShadowChunkInBounds(chunkX, chunkZ) {
	assertFinite(chunkX, 'chunkX');
	assertFinite(chunkZ, 'chunkZ');
	const bounds = getCanonicalSceneShadowChunkBounds();
	return chunkX >= bounds.x.min && chunkX <= bounds.x.max
		&& chunkZ >= bounds.z.min && chunkZ <= bounds.z.max;
}

export function resolveCanonicalSceneShadowTerrainOwnership({ profile = 'mobile', anchor } = {}) {
	const profilePolicy = CANONICAL_SCENE_SHADOW_POLICY.profiles[profile];
	if (!profilePolicy) throw new Error(`unknown canonical scene shadow profile: ${profile}`);
	if (!anchor) throw new TypeError('anchor is required');
	assertFinite(Number(anchor.x), 'anchor.x');
	assertFinite(Number(anchor.z), 'anchor.z');
	const size = CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.chunkSizeMeters;
	const centerX = Math.round(Number(anchor.x) / size);
	const centerZ = Math.round(Number(anchor.z) / size);
	const coords = [];
	for (let dx = -profilePolicy.terrainChunkRadius; dx <= profilePolicy.terrainChunkRadius; dx += 1) {
		for (let dz = -profilePolicy.terrainChunkRadius; dz <= profilePolicy.terrainChunkRadius; dz += 1) {
			const x = centerX + dx;
			const z = centerZ + dz;
			if (isCanonicalSceneShadowChunkInBounds(x, z)) coords.push(Object.freeze({ x, z }));
		}
	}
	coords.sort((a, b) => a.x - b.x || a.z - b.z);
	return Object.freeze(coords);
}

function coordKey(coord) {
	return `${coord.x},${coord.z}`;
}

function pruneTerrainToPlannedGrid(windowState) {
	const ownership = resolveCanonicalSceneShadowTerrainOwnership({
		profile: windowState.profile,
		anchor: windowState.anchor,
	});
	const allowed = new Set(ownership.map(coordKey));
	for (const terrain of [...windowState.terrainGroup.children]) {
		const coord = terrain.userData.chunkCoord;
		if (coord && allowed.has(coordKey(coord))) continue;
		windowState.terrainGroup.remove(terrain);
		disposeCanonicalTerrainShadowChunk(terrain);
	}
	windowState.migrationTerrainOwnership = ownership;
	return ownership;
}

/**
 * Creates a Run193 scene window, then narrows only its terrain residents to the planned full-map
 * grid. The underlying Run193 adapter remains unchanged and remains the rollback boundary.
 */
export function createCanonicalSceneShadowMigrationWindow(options = {}) {
	const windowState = createCanonicalSceneShadowWindow(options);
	pruneTerrainToPlannedGrid(windowState);
	return windowState;
}

export function summarizeCanonicalSceneShadowMigrationWindow(windowState) {
	const base = summarizeCanonicalSceneShadowWindow(windowState);
	const ownership = windowState.migrationTerrainOwnership || resolveCanonicalSceneShadowTerrainOwnership({
		profile: windowState.profile,
		anchor: windowState.anchor,
	});
	return Object.freeze({
		...base,
		migrationPolicy: CANONICAL_SCENE_SHADOW_MIGRATION_POLICY.key,
		terrainOwnership: Object.freeze(ownership.map((coord) => `${coord.x},${coord.z}`)),
	});
}

export function disposeCanonicalSceneShadowMigrationWindow(windowState) {
	disposeCanonicalSceneShadowWindow(windowState);
}
