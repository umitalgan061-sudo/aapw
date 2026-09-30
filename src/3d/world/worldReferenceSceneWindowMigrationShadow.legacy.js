/**
 * Run 194 supplementary shadow-only ownership harness for the planned canonical full-reference world.
 *
 * This module deliberately wraps Run193 instead of growing the 562/600-line scene adapter. It
 * classifies the planned 27x21 canonical chunk grid, distinguishes canonical resident chunks from
 * disposable edge padding, and models one-active-window replacement/disposal ownership. Nothing in
 * the live scene/chunk/gameplay import graph consumes this module.
 * @module world/worldReferenceSceneWindowMigrationShadow
 */

import { FULL_REFERENCE_WORLD_MIGRATION_PLAN } from './worldReferenceMigrationPlan.js';
import {
	CANONICAL_SCENE_SHADOW_POLICY,
	buildCanonicalSceneShadowPlan,
	createCanonicalSceneShadowWindow,
	disposeCanonicalSceneShadowWindow,
	summarizeCanonicalSceneShadowWindow,
} from './worldReferenceSceneShadowAdapter.js';

export const CANONICAL_SCENE_WINDOW_MIGRATION_POLICY = Object.freeze({
	key: 'run194-canonical-scene-window-migration-shadow-v1',
	plannedGridColumns: FULL_REFERENCE_WORLD_MIGRATION_PLAN.gridColumns,
	plannedGridRows: FULL_REFERENCE_WORLD_MIGRATION_PLAN.gridRows,
	chunkSizeMeters: FULL_REFERENCE_WORLD_MIGRATION_PLAN.chunkSizeMeters,
});

function assertFinite(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function clamp(value, min, max) {
	return Math.max(min, Math.min(max, value));
}

function coordKey(x, z) {
	return `${x},${z}`;
}

function freezeCoords(coords) {
	return Object.freeze(coords.map((coord) => Object.freeze({ ...coord })));
}

/** Returns the exact centered chunk-index ownership rectangle implied by the existing 27x21 plan. */
export function buildCanonicalSceneChunkOwnershipGrid() {
	const migration = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
	const chunkSizeMeters = migration.chunkSizeMeters;
	const minChunkX = -Math.floor(migration.gridColumns / 2);
	const minChunkZ = -Math.floor(migration.gridRows / 2);
	const maxChunkX = minChunkX + migration.gridColumns - 1;
	const maxChunkZ = minChunkZ + migration.gridRows - 1;
	const cells = [];
	for (let x = minChunkX; x <= maxChunkX; x += 1) {
		for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
			cells.push(Object.freeze({ x, z, key: coordKey(x, z), centerX: x * chunkSizeMeters, centerZ: z * chunkSizeMeters }));
		}
	}
	const gridWidthMeters = migration.gridColumns * chunkSizeMeters;
	const gridDepthMeters = migration.gridRows * chunkSizeMeters;
	return Object.freeze({
		version: CANONICAL_SCENE_WINDOW_MIGRATION_POLICY.key,
		columns: migration.gridColumns,
		rows: migration.gridRows,
		chunkSizeMeters,
		minChunkX,
		maxChunkX,
		minChunkZ,
		maxChunkZ,
		cellCount: cells.length,
		cells: Object.freeze(cells),
		worldWidthMeters: migration.worldWidthMeters,
		worldDepthMeters: migration.worldDepthMeters,
		gridWidthMeters,
		gridDepthMeters,
		edgeOverhangXMeters: (gridWidthMeters - migration.worldWidthMeters) * 0.5,
		edgeOverhangZMeters: (gridDepthMeters - migration.worldDepthMeters) * 0.5,
	});
}

/** Maps a planned-world point to its unique canonical owner chunk, clamping only beyond grid limits. */
export function canonicalSceneChunkOwnerForWorldPoint(worldX, worldZ, grid = buildCanonicalSceneChunkOwnershipGrid()) {
	assertFinite(worldX, 'worldX');
	assertFinite(worldZ, 'worldZ');
	const rawX = Math.round(worldX / grid.chunkSizeMeters);
	const rawZ = Math.round(worldZ / grid.chunkSizeMeters);
	const x = clamp(rawX, grid.minChunkX, grid.maxChunkX);
	const z = clamp(rawZ, grid.minChunkZ, grid.maxChunkZ);
	return Object.freeze({
		x,
		z,
		key: coordKey(x, z),
		rawX,
		rawZ,
		clamped: x !== rawX || z !== rawZ,
	});
}

/** Pure resident-coordinate classifier for a Run193 scene window anchor. */
export function summarizeCanonicalSceneWindowChunkOwnership(anchor, profile = 'mobile') {
	if (!anchor) throw new TypeError('anchor is required');
	assertFinite(Number(anchor.x), 'anchor.x');
	assertFinite(Number(anchor.z), 'anchor.z');
	const profilePolicy = CANONICAL_SCENE_SHADOW_POLICY.profiles[profile];
	if (!profilePolicy) throw new Error(`unknown canonical scene shadow profile: ${profile}`);
	const grid = buildCanonicalSceneChunkOwnershipGrid();
	const centerChunkX = Math.round(Number(anchor.x) / grid.chunkSizeMeters);
	const centerChunkZ = Math.round(Number(anchor.z) / grid.chunkSizeMeters);
	const canonical = [];
	const padding = [];
	for (let dx = -profilePolicy.terrainChunkRadius; dx <= profilePolicy.terrainChunkRadius; dx += 1) {
		for (let dz = -profilePolicy.terrainChunkRadius; dz <= profilePolicy.terrainChunkRadius; dz += 1) {
			const coord = { x: centerChunkX + dx, z: centerChunkZ + dz };
			const inside = coord.x >= grid.minChunkX && coord.x <= grid.maxChunkX
				&& coord.z >= grid.minChunkZ && coord.z <= grid.maxChunkZ;
			(inside ? canonical : padding).push(coord);
		}
	}
	const ownerChunk = canonicalSceneChunkOwnerForWorldPoint(Number(anchor.x), Number(anchor.z), grid);
	return Object.freeze({
		profile,
		centerChunk: Object.freeze({ x: centerChunkX, z: centerChunkZ }),
		ownerChunk,
		residentCount: canonical.length + padding.length,
		canonicalResidentCount: canonical.length,
		paddingResidentCount: padding.length,
		canonicalCoords: freezeCoords(canonical),
		paddingCoords: freezeCoords(padding),
		ownerResident: canonical.some((coord) => coord.x === ownerChunk.x && coord.z === ownerChunk.z),
	});
}

/**
 * Exhaustively proves the ownership topology for every one of the planned 567 chunk-center anchors.
 * Edge padding is explicit and never counted as canonical ownership.
 */
export function buildCanonicalSceneGridEdgeCoverage(profile = 'mobile') {
	const grid = buildCanonicalSceneChunkOwnershipGrid();
	const union = new Set();
	let minCanonicalResidentCount = Infinity;
	let maxCanonicalResidentCount = 0;
	let maxPaddingResidentCount = 0;
	let fullCanonicalWindowCount = 0;
	let edgeOwnerCellCount = 0;
	for (const cell of grid.cells) {
		const ownership = summarizeCanonicalSceneWindowChunkOwnership({ x: cell.centerX, z: cell.centerZ }, profile);
		if (!ownership.ownerResident || ownership.ownerChunk.key !== cell.key) {
			throw new Error(`owner chunk not resident for ${cell.key}`);
		}
		for (const coord of ownership.canonicalCoords) union.add(coordKey(coord.x, coord.z));
		minCanonicalResidentCount = Math.min(minCanonicalResidentCount, ownership.canonicalResidentCount);
		maxCanonicalResidentCount = Math.max(maxCanonicalResidentCount, ownership.canonicalResidentCount);
		maxPaddingResidentCount = Math.max(maxPaddingResidentCount, ownership.paddingResidentCount);
		if (ownership.paddingResidentCount === 0) fullCanonicalWindowCount += 1;
		if (cell.x === grid.minChunkX || cell.x === grid.maxChunkX || cell.z === grid.minChunkZ || cell.z === grid.maxChunkZ) edgeOwnerCellCount += 1;
	}
	return Object.freeze({
		profile,
		visitedOwnerCellCount: grid.cells.length,
		coveredCanonicalCellCount: union.size,
		minCanonicalResidentCount,
		maxCanonicalResidentCount,
		maxPaddingResidentCount,
		fullCanonicalWindowCount,
		edgeOwnerCellCount,
	});
}

/** Reads the real Run193 terrain meshes and labels each resident chunk as canonical or edge padding. */
export function describeCanonicalSceneWindowOwnership(windowState) {
	if (!windowState || !windowState.terrainGroup) throw new TypeError('windowState is required');
	const predicted = summarizeCanonicalSceneWindowChunkOwnership(windowState.anchor, windowState.profile);
	const grid = buildCanonicalSceneChunkOwnershipGrid();
	const canonical = [];
	const padding = [];
	const seen = new Set();
	for (const terrain of windowState.terrainGroup.children) {
		const coord = terrain.userData?.chunkCoord;
		if (!coord) throw new Error('terrain chunk missing userData.chunkCoord');
		const key = coordKey(coord.x, coord.z);
		if (seen.has(key)) throw new Error(`duplicate resident terrain chunk ${key}`);
		seen.add(key);
		const target = coord.x >= grid.minChunkX && coord.x <= grid.maxChunkX
			&& coord.z >= grid.minChunkZ && coord.z <= grid.maxChunkZ ? canonical : padding;
		target.push({ x: coord.x, z: coord.z });
	}
	const actualKeys = [...seen].sort();
	const predictedKeys = [...predicted.canonicalCoords, ...predicted.paddingCoords]
		.map((coord) => coordKey(coord.x, coord.z)).sort();
	return Object.freeze({
		...predicted,
		actualCanonicalResidentCount: canonical.length,
		actualPaddingResidentCount: padding.length,
		actualCanonicalCoords: freezeCoords(canonical),
		actualPaddingCoords: freezeCoords(padding),
		actualMatchesPredicted: JSON.stringify(actualKeys) === JSON.stringify(predictedKeys),
	});
}

export function buildCanonicalBridgeWindowOwnershipTargets(plan = buildCanonicalSceneShadowPlan()) {
	const grid = buildCanonicalSceneChunkOwnershipGrid();
	return Object.freeze(plan.bridgePlan.bridges.map((bridge) => Object.freeze({
		bridgeId: bridge.id,
		edgeId: bridge.edgeId,
		centerX: bridge.centerX,
		centerZ: bridge.centerZ,
		structuralSpanMeters: bridge.structuralSpanMeters,
		ownerChunk: canonicalSceneChunkOwnerForWorldPoint(bridge.centerX, bridge.centerZ, grid),
	})));
}

function disposedSnapshot(active) {
	if (!active) return null;
	const state = active.windowState;
	return Object.freeze({
		generation: active.generation,
		targetBridgeId: active.targetBridgeId,
		disposed: state.disposed === true,
		rootChildren: state.root.children.length,
		terrainChildren: state.terrainGroup.children.length,
		bridgeChildren: state.bridgeGroup.children.length,
		rockChildren: state.rockGroup.children.length,
	});
}

/** One-active-window scene ownership facade used only by the Run194 migration proof. */
export function createCanonicalSceneWindowMigrationHarness({ scene = null, profile = 'mobile' } = {}) {
	if (!CANONICAL_SCENE_SHADOW_POLICY.profiles[profile]) throw new Error(`unknown canonical scene shadow profile: ${profile}`);
	const plan = buildCanonicalSceneShadowPlan();
	const targets = buildCanonicalBridgeWindowOwnershipTargets(plan);
	const targetById = new Map(targets.map((target) => [target.bridgeId, target]));
	const history = [];
	let active = null;
	let generation = 0;

	function disposeActive() {
		if (!active) return null;
		if (scene) scene.remove(active.windowState.root);
		disposeCanonicalSceneShadowWindow(active.windowState);
		const snapshot = disposedSnapshot(active);
		history.push(snapshot);
		active = null;
		return snapshot;
	}

	function replace({ anchor, targetBridgeId = null }) {
		if (!anchor) throw new TypeError('anchor is required');
		assertFinite(Number(anchor.x), 'anchor.x');
		assertFinite(Number(anchor.z), 'anchor.z');
		const previousDisposed = disposeActive();
		const windowState = createCanonicalSceneShadowWindow({
			profile,
			anchor: { x: Number(anchor.x), z: Number(anchor.z), bridgeId: targetBridgeId },
		});
		generation += 1;
		if (scene) scene.add(windowState.root);
		active = {
			generation,
			targetBridgeId,
			windowState,
			summary: summarizeCanonicalSceneShadowWindow(windowState),
			ownership: describeCanonicalSceneWindowOwnership(windowState),
		};
		return { ...active, previousDisposed };
	}

	function replaceAtBridge(bridgeId) {
		const target = targetById.get(bridgeId);
		if (!target) throw new Error(`unknown canonical bridge target: ${bridgeId}`);
		return replace({
			anchor: { x: target.centerX, z: target.centerZ },
			targetBridgeId: bridgeId,
		});
	}

	return Object.freeze({
		version: CANONICAL_SCENE_WINDOW_MIGRATION_POLICY.key,
		profile,
		plan,
		targets,
		replace,
		replaceAtBridge,
		dispose: disposeActive,
		getActive() { return active; },
		getHistory() { return Object.freeze([...history]); },
	});
}
