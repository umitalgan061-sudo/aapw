/**
 * Minimal chunk load/unload manager for `world/terrain.js`.
 *
 * Phase 1 scope: loads a fixed square neighborhood of chunks around a center coordinate once, at
 * scene-bootstrap time, using `CHUNK_CONFIG.STREAM_RADIUS_CHUNKS`. Distance-based dynamic load/
 * unload as the player moves — the actual "500m streaming" requirement — is a later FAZ 1
 * sub-task, once a player/camera-follow position exists to stream around. Keeping load/unload as
 * explicit methods now (instead of only ever loading once) means that later work is a caller
 * change, not a rewrite of this class.
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
	 */
	constructor({ scene, chunkSizeMeters, seed }) {
		this.scene = scene;
		this.chunkSizeMeters = chunkSizeMeters;
		this.seed = seed;
		/** @type {Map<string, import('three').Mesh>} */
		this.loaded = new Map();
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

		const mesh = createTerrainChunk({ chunkX, chunkZ, size: this.chunkSizeMeters, seed: this.seed });
		this.scene.add(mesh);
		this.loaded.set(key, mesh);
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

	/** @returns {number} Number of currently-loaded chunks. */
	get loadedCount() {
		return this.loaded.size;
	}

	/** @returns {number} Total area, in km², covered by currently-loaded chunks. */
	getCoveredAreaKm2() {
		let total = 0;
		for (const mesh of this.loaded.values()) total += mesh.userData.areaKm2 ?? 0;
		return total;
	}

	/** Unloads every currently-loaded chunk. Call on scene teardown — memory-leak checklist. */
	disposeAll() {
		for (const key of [...this.loaded.keys()]) {
			const [chunkX, chunkZ] = key.split(',').map(Number);
			this.unloadChunk(chunkX, chunkZ);
		}
	}
}
