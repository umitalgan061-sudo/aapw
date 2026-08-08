/**
 * Run 194 V2: exact-reference clipped canonical chunk ownership and bridge-window lifecycle proof.
 *
 * Run194 V1 correctly found that a ceil(27x21) owner grid cannot render every outer cell as a full
 * 500m square: the canonical sampler rejects coordinates beyond the exact owner-map rectangle. This
 * supplementary module keeps all 567 owner coordinates but clips outer footprints to the exact
 * reference bounds before any height sample. It remains shadow-only and has no live consumer.
 * @module world/worldReferenceClippedWindowOwnershipShadow
 */

import * as THREE from 'three';
import { createWater, updateWater, disposeWater } from './water.js';
import { FULL_REFERENCE_WORLD_MIGRATION_PLAN } from './worldReferenceMigrationPlan.js';
import {
	CANONICAL_SCENE_SHADOW_POLICY,
	buildCanonicalSceneShadowPlan,
	createCanonicalSceneShadowGroundCollider,
} from './worldReferenceSceneShadowAdapter.js';
import {
	createCanonicalStoneBridgeMedievalArtV2,
	disposeCanonicalStoneBridgeMedievalArtV2,
} from './worldReferenceStoneBridgeMedievalArtV2.js';

export const CLIPPED_WINDOW_OWNERSHIP_POLICY = Object.freeze({
	key: 'run194-canonical-clipped-window-ownership-v2',
	chunkSizeMeters: FULL_REFERENCE_WORLD_MIGRATION_PLAN.chunkSizeMeters,
	gridColumns: FULL_REFERENCE_WORLD_MIGRATION_PLAN.gridColumns,
	gridRows: FULL_REFERENCE_WORLD_MIGRATION_PLAN.gridRows,
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

function pointSegmentDistanceXZ(point, a, b) {
	const dx = b.x - a.x;
	const dz = b.z - a.z;
	const length2 = dx * dx + dz * dz;
	if (length2 <= 1e-12) return Math.hypot(point.x - a.x, point.z - a.z);
	const t = clamp(((point.x - a.x) * dx + (point.z - a.z) * dz) / length2, 0, 1);
	return Math.hypot(point.x - (a.x + dx * t), point.z - (a.z + dz * t));
}

export function buildClippedCanonicalOwnershipGrid() {
	const migration = FULL_REFERENCE_WORLD_MIGRATION_PLAN;
	const size = migration.chunkSizeMeters;
	const minChunkX = -Math.floor(migration.gridColumns / 2);
	const minChunkZ = -Math.floor(migration.gridRows / 2);
	const maxChunkX = minChunkX + migration.gridColumns - 1;
	const maxChunkZ = minChunkZ + migration.gridRows - 1;
	const worldMinX = -migration.worldWidthMeters * 0.5;
	const worldMaxX = migration.worldWidthMeters * 0.5;
	const worldMinZ = -migration.worldDepthMeters * 0.5;
	const worldMaxZ = migration.worldDepthMeters * 0.5;
	const cells = [];
	for (let x = minChunkX; x <= maxChunkX; x += 1) {
		for (let z = minChunkZ; z <= maxChunkZ; z += 1) {
			const nominalMinX = x * size - size * 0.5;
			const nominalMaxX = x * size + size * 0.5;
			const nominalMinZ = z * size - size * 0.5;
			const nominalMaxZ = z * size + size * 0.5;
			const minX = Math.max(nominalMinX, worldMinX);
			const maxX = Math.min(nominalMaxX, worldMaxX);
			const minZ = Math.max(nominalMinZ, worldMinZ);
			const maxZ = Math.min(nominalMaxZ, worldMaxZ);
			const widthMeters = maxX - minX;
			const depthMeters = maxZ - minZ;
			if (!(widthMeters > 0) || !(depthMeters > 0)) throw new Error(`owner cell ${coordKey(x, z)} has no exact-reference footprint`);
			cells.push(Object.freeze({
				x,
				z,
				key: coordKey(x, z),
				minX,
				maxX,
				minZ,
				maxZ,
				centerX: (minX + maxX) * 0.5,
				centerZ: (minZ + maxZ) * 0.5,
				widthMeters,
				depthMeters,
				areaM2: widthMeters * depthMeters,
				clippedX: widthMeters < size - 1e-9,
				clippedZ: depthMeters < size - 1e-9,
			}));
		}
	}
	const byKey = new Map(cells.map((cell) => [cell.key, cell]));
	return Object.freeze({
		version: CLIPPED_WINDOW_OWNERSHIP_POLICY.key,
		columns: migration.gridColumns,
		rows: migration.gridRows,
		chunkSizeMeters: size,
		minChunkX,
		maxChunkX,
		minChunkZ,
		maxChunkZ,
		worldMinX,
		worldMaxX,
		worldMinZ,
		worldMaxZ,
		worldWidthMeters: migration.worldWidthMeters,
		worldDepthMeters: migration.worldDepthMeters,
		targetAreaM2: migration.worldWidthMeters * migration.worldDepthMeters,
		cellCount: cells.length,
		cells: Object.freeze(cells),
		getCell(x, z) { return byKey.get(coordKey(x, z)) || null; },
	});
}

export function auditClippedCanonicalOwnershipGrid(grid = buildClippedCanonicalOwnershipGrid()) {
	let areaM2 = 0;
	let clippedCellCount = 0;
	let fullCellCount = 0;
	let minWidthMeters = Infinity;
	let minDepthMeters = Infinity;
	let maxSeamErrorMeters = 0;
	for (const cell of grid.cells) {
		areaM2 += cell.areaM2;
		if (cell.clippedX || cell.clippedZ) clippedCellCount += 1;
		else fullCellCount += 1;
		minWidthMeters = Math.min(minWidthMeters, cell.widthMeters);
		minDepthMeters = Math.min(minDepthMeters, cell.depthMeters);
	}
	for (let z = grid.minChunkZ; z <= grid.maxChunkZ; z += 1) {
		const row = [];
		for (let x = grid.minChunkX; x <= grid.maxChunkX; x += 1) row.push(grid.getCell(x, z));
		maxSeamErrorMeters = Math.max(maxSeamErrorMeters, Math.abs(row[0].minX - grid.worldMinX), Math.abs(row[row.length - 1].maxX - grid.worldMaxX));
		for (let index = 1; index < row.length; index += 1) maxSeamErrorMeters = Math.max(maxSeamErrorMeters, Math.abs(row[index - 1].maxX - row[index].minX));
	}
	for (let x = grid.minChunkX; x <= grid.maxChunkX; x += 1) {
		const column = [];
		for (let z = grid.minChunkZ; z <= grid.maxChunkZ; z += 1) column.push(grid.getCell(x, z));
		maxSeamErrorMeters = Math.max(maxSeamErrorMeters, Math.abs(column[0].minZ - grid.worldMinZ), Math.abs(column[column.length - 1].maxZ - grid.worldMaxZ));
		for (let index = 1; index < column.length; index += 1) maxSeamErrorMeters = Math.max(maxSeamErrorMeters, Math.abs(column[index - 1].maxZ - column[index].minZ));
	}
	return Object.freeze({
		cellCount: grid.cellCount,
		fullCellCount,
		clippedCellCount,
		areaM2,
		areaErrorM2: Math.abs(areaM2 - grid.targetAreaM2),
		maxSeamErrorMeters,
		minWidthMeters,
		minDepthMeters,
		xEdgeTrimMeters: grid.chunkSizeMeters - minWidthMeters,
		zEdgeTrimMeters: grid.chunkSizeMeters - minDepthMeters,
	});
}

export function clippedCanonicalOwnerForWorldPoint(worldX, worldZ, grid = buildClippedCanonicalOwnershipGrid()) {
	assertFinite(worldX, 'worldX');
	assertFinite(worldZ, 'worldZ');
	if (worldX < grid.worldMinX - 1e-9 || worldX > grid.worldMaxX + 1e-9 || worldZ < grid.worldMinZ - 1e-9 || worldZ > grid.worldMaxZ + 1e-9) {
		throw new RangeError('world point outside exact canonical reference bounds');
	}
	const x = clamp(Math.round(worldX / grid.chunkSizeMeters), grid.minChunkX, grid.maxChunkX);
	const z = clamp(Math.round(worldZ / grid.chunkSizeMeters), grid.minChunkZ, grid.maxChunkZ);
	const cell = grid.getCell(x, z);
	if (!cell) throw new Error(`missing owner cell ${coordKey(x, z)}`);
	return cell;
}

export function buildClippedCanonicalWindowFootprints(anchor, profile = 'mobile', grid = buildClippedCanonicalOwnershipGrid()) {
	if (!anchor) throw new TypeError('anchor is required');
	assertFinite(Number(anchor.x), 'anchor.x');
	assertFinite(Number(anchor.z), 'anchor.z');
	const policy = CANONICAL_SCENE_SHADOW_POLICY.profiles[profile];
	if (!policy) throw new Error(`unknown canonical scene shadow profile: ${profile}`);
	const owner = clippedCanonicalOwnerForWorldPoint(Number(anchor.x), Number(anchor.z), grid);
	const cells = [];
	for (let dx = -policy.terrainChunkRadius; dx <= policy.terrainChunkRadius; dx += 1) {
		for (let dz = -policy.terrainChunkRadius; dz <= policy.terrainChunkRadius; dz += 1) {
			const cell = grid.getCell(owner.x + dx, owner.z + dz);
			if (cell) cells.push(cell);
		}
	}
	return Object.freeze({
		profile,
		owner,
		cells: Object.freeze(cells),
		residentCount: cells.length,
		clippedResidentCount: cells.filter((cell) => cell.clippedX || cell.clippedZ).length,
	});
}

function createClippedTerrainChunk(cell, sampleHeightMeters, seaLevelMeters, baseSegments) {
	const segmentsX = Math.max(2, Math.round(baseSegments * cell.widthMeters / CLIPPED_WINDOW_OWNERSHIP_POLICY.chunkSizeMeters));
	const segmentsZ = Math.max(2, Math.round(baseSegments * cell.depthMeters / CLIPPED_WINDOW_OWNERSHIP_POLICY.chunkSizeMeters));
	const geometry = new THREE.PlaneGeometry(cell.widthMeters, cell.depthMeters, segmentsX, segmentsZ);
	geometry.rotateX(-Math.PI / 2);
	const position = geometry.getAttribute('position');
	let minHeightMeters = Infinity;
	let maxHeightMeters = -Infinity;
	for (let index = 0; index < position.count; index += 1) {
		const worldX = clamp(cell.centerX + position.getX(index), cell.minX, cell.maxX);
		const worldZ = clamp(cell.centerZ + position.getZ(index), cell.minZ, cell.maxZ);
		const height = sampleHeightMeters(worldX, worldZ);
		assertFinite(height, 'sampleHeightMeters result');
		position.setY(index, height);
		minHeightMeters = Math.min(minHeightMeters, height);
		maxHeightMeters = Math.max(maxHeightMeters, height);
	}
	position.needsUpdate = true;
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	const material = new THREE.MeshStandardMaterial({ color: 0x516a49, roughness: 1, metalness: 0 });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = `run194-clipped-canonical-terrain-${cell.key}`;
	mesh.position.set(cell.centerX, 0, cell.centerZ);
	mesh.receiveShadow = true;
	mesh.userData.clippedCanonicalOwner = Object.freeze({
		x: cell.x,
		z: cell.z,
		widthMeters: cell.widthMeters,
		depthMeters: cell.depthMeters,
		clippedX: cell.clippedX,
		clippedZ: cell.clippedZ,
		segmentsX,
		segmentsZ,
		minHeightMeters,
		maxHeightMeters,
		seaLevelMeters,
	});
	return mesh;
}

function disposeClippedTerrainGroup(group) {
	for (const mesh of [...group.children]) {
		group.remove(mesh);
		mesh.geometry?.dispose?.();
		mesh.material?.dispose?.();
	}
}

export function createClippedCanonicalTerrainWindow({ plan, anchor, profile = 'mobile' }) {
	if (!plan?.context?.sampler) throw new TypeError('canonical scene plan is required');
	const policy = CANONICAL_SCENE_SHADOW_POLICY.profiles[profile];
	if (!policy) throw new Error(`unknown canonical scene shadow profile: ${profile}`);
	const footprints = buildClippedCanonicalWindowFootprints(anchor, profile);
	const group = new THREE.Group();
	group.name = `run194-clipped-canonical-terrain-window-${profile}`;
	for (const cell of footprints.cells) {
		group.add(createClippedTerrainChunk(cell, plan.context.sampler, plan.context.seaLevelMeters, policy.terrainSegments));
	}
	return Object.freeze({ group, footprints });
}

function selectedBridgesForAnchor(plan, anchor, radiusMeters) {
	return plan.bridgePlan.bridges.filter((bridge) => pointSegmentDistanceXZ(
		anchor,
		{ x: bridge.startX, z: bridge.startZ },
		{ x: bridge.endX, z: bridge.endZ },
	) <= radiusMeters);
}

export function buildClippedBridgeOwnershipTargets(plan = buildCanonicalSceneShadowPlan()) {
	const grid = buildClippedCanonicalOwnershipGrid();
	return Object.freeze(plan.bridgePlan.bridges.map((bridge) => Object.freeze({
		bridgeId: bridge.id,
		edgeId: bridge.edgeId,
		centerX: bridge.centerX,
		centerZ: bridge.centerZ,
		owner: clippedCanonicalOwnerForWorldPoint(bridge.centerX, bridge.centerZ, grid),
	})));
}

export function createClippedCanonicalBridgeOwnershipWindow({ plan, anchor, profile = 'mobile', targetBridgeId = null }) {
	if (!plan) throw new TypeError('plan is required');
	const policy = CANONICAL_SCENE_SHADOW_POLICY.profiles[profile];
	if (!policy) throw new Error(`unknown canonical scene shadow profile: ${profile}`);
	const resolvedAnchor = Object.freeze({ x: Number(anchor.x), z: Number(anchor.z), bridgeId: targetBridgeId });
	clippedCanonicalOwnerForWorldPoint(resolvedAnchor.x, resolvedAnchor.z);
	const terrain = createClippedCanonicalTerrainWindow({ plan, anchor: resolvedAnchor, profile });
	const selectedBridges = selectedBridgesForAnchor(plan, resolvedAnchor, policy.radiusMeters);
	const selectedIds = new Set(selectedBridges.map((bridge) => bridge.id));
	const selectedApproaches = plan.approaches.filter((approach) => selectedIds.has(approach.bridgeId));
	const bridgeGroup = createCanonicalStoneBridgeMedievalArtV2({ bridges: selectedBridges });
	const water = createWater(plan.context.seaLevelMeters);
	const root = new THREE.Group();
	root.name = `run194-clipped-bridge-ownership-window-${profile}`;
	root.add(terrain.group, bridgeGroup, water);
	const state = {
		profile,
		plan,
		anchor: resolvedAnchor,
		root,
		terrainGroup: terrain.group,
		footprints: terrain.footprints,
		bridgeGroup,
		water,
		selectedBridges: Object.freeze(selectedBridges),
		selectedApproaches: Object.freeze(selectedApproaches),
		disposed: false,
	};
	state.groundCollider = createCanonicalSceneShadowGroundCollider(state);
	return state;
}

export function summarizeClippedCanonicalBridgeOwnershipWindow(state) {
	return Object.freeze({
		profile: state.profile,
		anchorX: state.anchor.x,
		anchorZ: state.anchor.z,
		targetBridgeId: state.anchor.bridgeId,
		ownerChunk: Object.freeze({ x: state.footprints.owner.x, z: state.footprints.owner.z }),
		terrainChunkCount: state.terrainGroup.children.length,
		clippedTerrainChunkCount: state.footprints.clippedResidentCount,
		selectedBridgeIds: Object.freeze(state.selectedBridges.map((bridge) => bridge.id)),
		selectedApproachCount: state.selectedApproaches.length,
	});
}

export function updateClippedCanonicalBridgeOwnershipWindow(state, cameraPosition, elapsedSeconds = 0) {
	if (!state || state.disposed) return;
	updateWater(state.water, cameraPosition, elapsedSeconds);
}

export function disposeClippedCanonicalBridgeOwnershipWindow(state) {
	if (!state || state.disposed) return;
	disposeClippedTerrainGroup(state.terrainGroup);
	disposeCanonicalStoneBridgeMedievalArtV2(state.bridgeGroup);
	disposeWater(state.water);
	state.root.clear();
	state.disposed = true;
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
	});
}

export function createClippedCanonicalWindowOwnershipHarness({ scene = null, profile = 'mobile' } = {}) {
	const plan = buildCanonicalSceneShadowPlan();
	const targets = buildClippedBridgeOwnershipTargets(plan);
	const targetById = new Map(targets.map((target) => [target.bridgeId, target]));
	const history = [];
	let active = null;
	let generation = 0;

	function disposeActive() {
		if (!active) return null;
		if (scene) scene.remove(active.windowState.root);
		disposeClippedCanonicalBridgeOwnershipWindow(active.windowState);
		const snapshot = disposedSnapshot(active);
		history.push(snapshot);
		active = null;
		return snapshot;
	}

	function replace({ anchor, targetBridgeId = null }) {
		const previousDisposed = disposeActive();
		const windowState = createClippedCanonicalBridgeOwnershipWindow({ plan, anchor, profile, targetBridgeId });
		generation += 1;
		if (scene) scene.add(windowState.root);
		active = Object.freeze({
			generation,
			targetBridgeId,
			windowState,
			summary: summarizeClippedCanonicalBridgeOwnershipWindow(windowState),
			previousDisposed,
		});
		return active;
	}

	function replaceAtBridge(bridgeId) {
		const target = targetById.get(bridgeId);
		if (!target) throw new Error(`unknown bridge target: ${bridgeId}`);
		return replace({ anchor: { x: target.centerX, z: target.centerZ }, targetBridgeId: bridgeId });
	}

	return Object.freeze({
		version: CLIPPED_WINDOW_OWNERSHIP_POLICY.key,
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
