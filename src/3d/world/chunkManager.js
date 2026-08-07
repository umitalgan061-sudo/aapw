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
	constructor({ scene, chunkSizeMeters, seed, flattenPads = [] }) {
		this.scene = scene;
		this.chunkSizeMeters = chunkSizeMeters;
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

		const mesh = createTerrainChunk({ chunkX, chunkZ, size: this.chunkSizeMeters, seed: this.seed, flattenPads: this.flattenPads });
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
