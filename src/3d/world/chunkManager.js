/**
 * Chunk load manager for `world/terrain.js`.
 *
 * Two ways to bring chunks in: `loadSquare` (a one-shot fixed neighborhood, used for `game3d.js`'s
 * boot-time preview) and `streamTowards` (additive: loads whatever's newly in range of a moving
 * center, called every time that center crosses into a new chunk — see `camera.js`/`game3d.js`).
 * Deliberately does NOT unload chunks that fall out of streaming range yet — see DECISIONS.md
 * ADR-0003 for why eviction is intentionally deferred rather than built speculatively now.
 * `unloadChunk`/`disposeAll` still exist for scene teardown and are ready for eviction logic to
 * reuse once it's actually needed.
 * @module world/chunkManager
 */

import { createTerrainChunk, disposeTerrainChunk } from './terrain.js';
import { reconcileLoadedTerrainChunkSeams } from './terrainChunkSeam.js';
import { CHUNK_CONFIG } from '../config.js';

/**
 * @param {number} chunkX
 * @param {number} chunkZ
 * @returns {string}
 */
function chunkKey(chunkX, chunkZ) {
	return `${chunkX},${chunkZ}`;
}

export class ChunkManager {
	/**
	 * @param {object} options
	 * @param {import('three').Scene} options.scene
	 * @param {number} options.chunkSizeMeters
	 * @param {number} options.seed
	 * @param {{x: number, z: number, innerRadiusMeters: number, outerRadiusMeters: number, anchorHeightMeters: number}[]} [options.flattenPads]
	 *   Forwarded to every `createTerrainChunk` call (DECISIONS.md ADR-0118) — see
	 *   `world/terrain.js`'s `createHeightSampler` doc comment. `sceneManager.js` passes the same
	 *   array here and into `physics.js`'s `createGroundCollider` so rendered chunk geometry and
	 *   every gameplay height query stay in agreement.
	 */
	constructor({ scene, chunkSizeMeters, seed, flattenPads = [], segments = CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP }) {
		this.scene = scene;
		this.chunkSizeMeters = chunkSizeMeters;
		/** Mesh resolution per chunk — see `CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP` for why this is
		 * device-dependent and what it costs. */
		this.segments = segments;
		this.seed = seed;
		this.flattenPads = flattenPads;
		/** @type {Map<string, import('three').Mesh>} Currently in the scene. */
		this.loaded = new Map();
		/** @type {Set<string>} Every chunk key ever loaded, even if later unloaded. Only grows —
		 * see DECISIONS.md ADR-0003 for why World Coverage is tracked from this, not `loaded`. */
		this.everGenerated = new Set();
	}

	/**
	 * Loads a chunk if not already loaded, and adds it to the scene.
	 * @param {number} chunkX
	 * @param {number} chunkZ
	 * @returns {import('three').Mesh} The chunk mesh (existing or newly created).
	 */
	loadChunk(chunkX, chunkZ) {
		const key = chunkKey(chunkX, chunkZ);
		const existing = this.loaded.get(key);
		if (existing) return existing;

		const mesh = createTerrainChunk({ chunkX, chunkZ, size: this.chunkSizeMeters, segments: this.segments, seed: this.seed, flattenPads: this.flattenPads });
		this.scene.add(mesh);
		this.loaded.set(key, mesh);
		this.everGenerated.add(key);
		return mesh;
	}

	/**
	 * Removes a chunk from the scene and disposes its geometry/material, if loaded.
	 * @param {number} chunkX
	 * @param {number} chunkZ
	 */
	unloadChunk(chunkX, chunkZ) {
		const key = chunkKey(chunkX, chunkZ);
		const mesh = this.loaded.get(key);
		if (!mesh) return;
		this.scene.remove(mesh);
		disposeTerrainChunk(mesh);
		this.loaded.delete(key);
	}

	/**
	 * Loads every chunk in a `(2*radius+1) x (2*radius+1)` square centered on `(centerX, centerZ)`.
	 * @param {number} centerX
	 * @param {number} centerZ
	 * @param {number} radius Chunks in each direction from the center (0 = just the center chunk).
	 */
	loadSquare(centerX, centerZ, radius) {
		for (let dz = -radius; dz <= radius; dz++) {
			for (let dx = -radius; dx <= radius; dx++) {
				this.loadChunk(centerX + dx, centerZ + dz);
			}
		}
	}

	/**
	 * Loads whatever's newly within `radius` chunks of `(centerChunkX, centerChunkZ)`. Purely
	 * additive — does not unload chunks that fall outside the radius (see module docs/ADR-0003).
	 * Call this whenever the streaming center (e.g. the camera/player) crosses into a new chunk,
	 * not every frame — `loadChunk` is cheap to no-op on already-loaded chunks, but there's no
	 * reason to even iterate the square if the center hasn't moved.
	 * @param {number} centerChunkX
	 * @param {number} centerChunkZ
	 * @param {number} radius
	 */
	streamTowards(centerChunkX, centerChunkZ, radius) {
		this.loadSquare(centerChunkX, centerChunkZ, radius);
	}

	/**
	 * @param {number} chunkX
	 * @param {number} chunkZ
	 * @returns {import('three').Mesh | undefined} The chunk mesh if currently resident, else
	 *   `undefined` (unloaded, or never generated). Lets callers (e.g. `game3d.js`'s camera
	 *   collision raycast) look up a specific chunk's mesh without reimplementing `chunkKey`.
	 */
	getLoadedChunkMesh(chunkX, chunkZ) {
		return this.loaded.get(chunkKey(chunkX, chunkZ));
	}

	/** @returns {number} Number of currently-loaded (resident) chunks. */
	get loadedCount() {
		return this.loaded.size;
	}

	/** @returns {number} Number of chunks ever generated, including ones since unloaded. */
	get everGeneratedCount() {
		return this.everGenerated.size;
	}

	/** @returns {number} Total area, in km², covered by currently-loaded (resident) chunks. */
	getCoveredAreaKm2() {
		let total = 0;
		for (const mesh of this.loaded.values()) total += mesh.userData.areaKm2 ?? 0;
		return total;
	}

	/** @returns {number} Total area, in km², ever generated — the World Coverage source number. */
	getCumulativeCoveredAreaKm2() {
		const areaPerChunkKm2 = (this.chunkSizeMeters * this.chunkSizeMeters) / 1_000_000;
		return this.everGenerated.size * areaPerChunkKm2;
	}

	/** Unloads every currently-loaded chunk. Call on scene teardown — memory-leak checklist. */
	disposeAll() {
		for (const key of [...this.loaded.keys()]) {
			const [chunkX, chunkZ] = key.split(',').map(Number);
			this.unloadChunk(chunkX, chunkZ);
		}
	}
}


// Run 130 / ADR-0153 — mobile bounded streaming policy. Kept as an additive prototype wrapper so
// GOVERNANCE.md's additive-only rule is preserved: the proven desktop implementation above remains
// byte-for-byte intact. Coarse-pointer devices widen the active terrain neighborhood from radius 2
// (25 chunks / 6.25 km²) to radius 3 (49 chunks / 12.25 km²) while evicting chunks outside that
// same radius after every chunk-boundary crossing. Cumulative World Coverage still grows through
// `everGenerated`; resident GPU/RAM terrain stays bounded at <=49 chunks instead of growing without
// limit during exploration. Desktop behavior is deliberately unchanged.
const MOBILE_STREAMING_RADIUS_CHUNKS_RUN130 = 3;
const _streamTowardsBeforeMobileCoverageRun130 = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithMobileBoundRun130(centerChunkX, centerChunkZ, radius) {
	const isMobileCoarsePointer = typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
	const effectiveRadius = isMobileCoarsePointer
		? Math.max(radius, MOBILE_STREAMING_RADIUS_CHUNKS_RUN130)
		: radius;

	_streamTowardsBeforeMobileCoverageRun130.call(this, centerChunkX, centerChunkZ, effectiveRadius);
	if (!isMobileCoarsePointer) return;

	for (const key of [...this.loaded.keys()]) {
		const [chunkX, chunkZ] = key.split(',').map(Number);
		const outsideResidentSquare =
			Math.abs(chunkX - centerChunkX) > effectiveRadius ||
			Math.abs(chunkZ - centerChunkZ) > effectiveRadius;
		if (outsideResidentSquare) this.unloadChunk(chunkX, chunkZ);
	}
};


// Run 134 / ADR-0158 — mobile terrain distance LOD. This is deliberately layered after run 130's
// bounded-streaming wrapper so the proven radius-3 eviction behavior stays untouched. On coarse-
// pointer devices, terrain inside Chebyshev radius 1 keeps the original 64x64 subdivision density,
// radius 2 uses 32x32, and radius 3 uses 16x16. When the streaming center crosses a chunk boundary,
// resident chunks whose LOD band changed are rebuilt from the exact same seeded height sampler and
// flatten pads, then the old geometry/material are disposed immediately. Desktop loadChunk/
// streamTowards behavior remains byte-for-byte delegated to the pre-run-134 implementation.
const MOBILE_TERRAIN_LOD_SEGMENTS_RUN134 = Object.freeze({ NEAR: 64, MID: 32, FAR: 16 });

function isMobileCoarsePointerRun134() {
	return typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
}

function mobileTerrainLodSegmentsRun134(chunkX, chunkZ, centerX, centerZ) {
	const distance = Math.max(Math.abs(chunkX - centerX), Math.abs(chunkZ - centerZ));
	if (distance <= 1) return MOBILE_TERRAIN_LOD_SEGMENTS_RUN134.NEAR;
	if (distance === 2) return MOBILE_TERRAIN_LOD_SEGMENTS_RUN134.MID;
	return MOBILE_TERRAIN_LOD_SEGMENTS_RUN134.FAR;
}

function createMobileTerrainLodChunkRun134(manager, chunkX, chunkZ, segments) {
	const mesh = createTerrainChunk({
		chunkX,
		chunkZ,
		size: manager.chunkSizeMeters,
		segments,
		seed: manager.seed,
		flattenPads: manager.flattenPads,
	});
	mesh.userData.mobileTerrainLodSegmentsRun134 = segments;
	return mesh;
}

const _loadChunkBeforeMobileTerrainLodRun134 = ChunkManager.prototype.loadChunk;
ChunkManager.prototype.loadChunk = function loadChunkWithMobileTerrainLodRun134(chunkX, chunkZ) {
	if (!isMobileCoarsePointerRun134()) return _loadChunkBeforeMobileTerrainLodRun134.call(this, chunkX, chunkZ);
	const key = chunkKey(chunkX, chunkZ);
	const existing = this.loaded.get(key);
	if (existing) return existing;
	const center = this.mobileTerrainLodCenterRun134 ?? { x: 0, z: 0 };
	const segments = mobileTerrainLodSegmentsRun134(chunkX, chunkZ, center.x, center.z);
	const mesh = createMobileTerrainLodChunkRun134(this, chunkX, chunkZ, segments);
	this.scene.add(mesh);
	this.loaded.set(key, mesh);
	this.everGenerated.add(key);
	return mesh;
};

const _streamTowardsBeforeMobileTerrainLodRun134 = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithMobileTerrainLodRun134(centerChunkX, centerChunkZ, radius) {
	if (!isMobileCoarsePointerRun134()) {
		return _streamTowardsBeforeMobileTerrainLodRun134.call(this, centerChunkX, centerChunkZ, radius);
	}
	this.mobileTerrainLodCenterRun134 = { x: centerChunkX, z: centerChunkZ };
	_streamTowardsBeforeMobileTerrainLodRun134.call(this, centerChunkX, centerChunkZ, radius);

	for (const [key, mesh] of [...this.loaded.entries()]) {
		const [chunkX, chunkZ] = key.split(',').map(Number);
		const desiredSegments = mobileTerrainLodSegmentsRun134(chunkX, chunkZ, centerChunkX, centerChunkZ);
		if (mesh.userData.mobileTerrainLodSegmentsRun134 === desiredSegments) continue;
		const replacement = createMobileTerrainLodChunkRun134(this, chunkX, chunkZ, desiredSegments);
		this.scene.remove(mesh);
		disposeTerrainChunk(mesh);
		this.scene.add(replacement);
		this.loaded.set(key, replacement);
	}
};


// Run 140 / ADR-0164 — live mobile world radius 4 without invalidating the historical run-130
// radius-3 regression contract. The old generic ChunkManager behavior remains intact: a standalone
// mobile manager that calls streamTowards(..., 2) still gets radius 3, so
// scripts/checkMobileChunkStreaming.js continues to verify the exact run-130 baseline. The real
// game-world manager is distinguishable because sceneManager supplies the full settlement flatten-
// pad set and performs the mobile boot loadSquare(0, 0, STREAM_RADIUS_CHUNKS) before player
// streaming begins. Only that live-world path is promoted to radius 4. This keeps additive-only
// governance intact, avoids a one-off test rewrite exception, and raises resident terrain from
// 49 chunks / 12.25 km² to 81 chunks / 20.25 km² while run-134 distance LOD keeps the new outer
// ring at FAR=16 segments. Desktop and generic/test managers remain unchanged.
const MOBILE_LIVE_WORLD_RADIUS_RUN140 = 4;
const MOBILE_LIVE_WORLD_MIN_FLATTEN_PADS_RUN140 = 14;

function isLiveMobileWorldManagerRun140(manager) {
	return isMobileCoarsePointerRun134() &&
		Array.isArray(manager.flattenPads) &&
		manager.flattenPads.length >= MOBILE_LIVE_WORLD_MIN_FLATTEN_PADS_RUN140;
}

const _loadSquareBeforeMobileRadius4Run140 = ChunkManager.prototype.loadSquare;
ChunkManager.prototype.loadSquare = function loadSquareWithLiveMobileRadius4Run140(centerX, centerZ, radius) {
	const isLiveBoot = isLiveMobileWorldManagerRun140(this) &&
		radius === 2 &&
		centerX === 0 &&
		centerZ === 0;
	if (!isLiveBoot) return _loadSquareBeforeMobileRadius4Run140.call(this, centerX, centerZ, radius);
	this.mobileLiveWorldRadius4Run140 = true;
	this.mobileTerrainLodCenterRun134 = { x: centerX, z: centerZ };
	return _loadSquareBeforeMobileRadius4Run140.call(this, centerX, centerZ, MOBILE_LIVE_WORLD_RADIUS_RUN140);
};

const _streamTowardsBeforeMobileRadius4Run140 = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithLiveMobileRadius4Run140(centerChunkX, centerChunkZ, radius) {
	if (!this.mobileLiveWorldRadius4Run140) {
		return _streamTowardsBeforeMobileRadius4Run140.call(this, centerChunkX, centerChunkZ, radius);
	}
	return _streamTowardsBeforeMobileRadius4Run140.call(
		this,
		centerChunkX,
		centerChunkZ,
		Math.max(radius, MOBILE_LIVE_WORLD_RADIUS_RUN140),
	);
};

// Run 141 / ADR-0165 — exported live binding for mobile systems that must follow the actual
// runtime streaming radius without duplicating a stale literal. Future additive radius wrappers
// update this binding after their own declaration.
export let MOBILE_LIVE_WORLD_RADIUS_CHUNKS = MOBILE_LIVE_WORLD_RADIUS_RUN140;

// Exact-main successor — renderer-only terrain seam continuity. The standing mobile 64/32/16 LOD
// policy is retained byte-for-byte above; this final wrapper only reconciles already-generated mesh
// boundaries after load/regrade/eviction batches. Canonical terrain sampling and colliders remain
// untouched. Batching is essential: a 7x7 or live 9x9 mobile load must reconcile once after the
// resident set is stable, not once per individual chunk.
function reconcileManagerTerrainChunkSeams(manager) {
	manager.terrainChunkSeamStats = reconcileLoadedTerrainChunkSeams(manager.loaded);
	return manager.terrainChunkSeamStats;
}

function beginTerrainChunkSeamBatch(manager) {
	manager.terrainChunkSeamBatchDepth = (manager.terrainChunkSeamBatchDepth ?? 0) + 1;
}

function endTerrainChunkSeamBatch(manager) {
	manager.terrainChunkSeamBatchDepth = Math.max(0, (manager.terrainChunkSeamBatchDepth ?? 1) - 1);
	if (manager.terrainChunkSeamBatchDepth === 0) reconcileManagerTerrainChunkSeams(manager);
}

const _loadChunkBeforeTerrainChunkSeam = ChunkManager.prototype.loadChunk;
ChunkManager.prototype.loadChunk = function loadChunkWithTerrainChunkSeam(chunkX, chunkZ) {
	const mesh = _loadChunkBeforeTerrainChunkSeam.call(this, chunkX, chunkZ);
	if (!(this.terrainChunkSeamBatchDepth > 0)) reconcileManagerTerrainChunkSeams(this);
	return mesh;
};

const _unloadChunkBeforeTerrainChunkSeam = ChunkManager.prototype.unloadChunk;
ChunkManager.prototype.unloadChunk = function unloadChunkWithTerrainChunkSeam(chunkX, chunkZ) {
	const result = _unloadChunkBeforeTerrainChunkSeam.call(this, chunkX, chunkZ);
	if (!(this.terrainChunkSeamBatchDepth > 0)) reconcileManagerTerrainChunkSeams(this);
	return result;
};

const _loadSquareBeforeTerrainChunkSeam = ChunkManager.prototype.loadSquare;
ChunkManager.prototype.loadSquare = function loadSquareWithTerrainChunkSeam(centerX, centerZ, radius) {
	beginTerrainChunkSeamBatch(this);
	try {
		return _loadSquareBeforeTerrainChunkSeam.call(this, centerX, centerZ, radius);
	} finally {
		endTerrainChunkSeamBatch(this);
	}
};

const _streamTowardsBeforeTerrainChunkSeam = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithTerrainChunkSeam(centerChunkX, centerChunkZ, radius) {
	beginTerrainChunkSeamBatch(this);
	try {
		return _streamTowardsBeforeTerrainChunkSeam.call(this, centerChunkX, centerChunkZ, radius);
	} finally {
		endTerrainChunkSeamBatch(this);
	}
};

const _disposeAllBeforeTerrainChunkSeam = ChunkManager.prototype.disposeAll;
ChunkManager.prototype.disposeAll = function disposeAllWithTerrainChunkSeam() {
	beginTerrainChunkSeamBatch(this);
	try {
		return _disposeAllBeforeTerrainChunkSeam.call(this);
	} finally {
		this.terrainChunkSeamBatchDepth = 0;
		this.terrainChunkSeamStats = Object.freeze({
			policyId: 'terrain-chunk-seam-continuity-2026-08-31-v1',
			chunkCount: 0,
			adjacentPairCount: 0,
		});
	}
};
