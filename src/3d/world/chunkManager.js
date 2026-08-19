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
	constructor({ scene, chunkSizeMeters, seed, flattenPads = [], segments = CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP, roadCorridor = null }) {
		this.scene = scene;
		this.chunkSizeMeters = chunkSizeMeters;
		/** Mesh resolution per chunk — see `CHUNK_CONFIG.TERRAIN_SEGMENTS_DESKTOP` for why this is
		 * device-dependent and what it costs. */
		this.segments = segments;
		this.seed = seed;
		this.flattenPads = flattenPads;
		/** Road cut-and-fill bed (ADR-0304), forwarded verbatim to every `createTerrainChunk` call so the
		 * drawn ground and every gameplay height query agree along roads. */
		this.roadCorridor = roadCorridor;
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

		const mesh = createTerrainChunk({ chunkX, chunkZ, size: this.chunkSizeMeters, segments: this.segments, seed: this.seed, flattenPads: this.flattenPads, roadCorridor: this.roadCorridor });
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
		roadCorridor: manager.roadCorridor,
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


// Run 356 / ADR-0303 — desktop terrain distance LOD. Layered after runs 130/134/140 so every proven
// mobile path above stays byte-for-byte delegated; this wrapper only ever acts on desktop.
//
// **What this actually buys — and what it does not.** The motivation was that a vertex every 7.8 m
// (64 segments over a 500 m chunk) cannot represent anything finer than a ~16 m wavelength, so fine
// relief is averaged away before it reaches the screen. That ceiling is real and this lifts it to
// 3.9 m in the near band. But measurement (ADR-0303) says lifting it changed the *look* almost not at
// all: rendered high-frequency image energy moved 7.75 -> 7.99 / 16.02 -> 16.04 / 11.90 -> 11.83 /
// 20.51 -> 20.65 across four framings. The reason is that the height field has essentially no content
// at 4-16 m wavelengths to resolve — the finest layer, `roughness`, sits at ~45 m with its finest
// octave near 11 m at ~0.5 m amplitude. A finer mesh cannot show detail that was never generated.
//
// So the honest justification for this wrapper is **boot cost**, which it cuts by a measured 36%
// (23,697 ms -> 15,180 ms for the 529-chunk desktop preview), plus removing the resolution ceiling so
// that finer height-field content becomes worth generating at all. See ADR-0303 for why generating
// that content is currently blocked by `roadPathfinder.js`'s 60 m sampling grid rather than by
// anything here.
//
// **Why it was blocked until now.** `config.js` records the measured 128-segment failure: desktop
// boots `PHASE1_PREVIEW_RADIUS_CHUNKS` = 11, i.e. 529 chunks, and 129² vertices each meant ~8.8M
// main-thread samples against ~2.2M, which blocked `domcontentloaded` past its budget. Uniformly
// raising resolution was never affordable. Spending it *by distance* is.
//
//   band          chunks at boot   segments   apron vertices
//   near (d<=2)              25         128      25 x 131² = 429k
//   mid  (d<=5)              96          64      96 x  67² = 431k
//   far  (d> 5)             408          32     408 x  35² = 500k
//                                               total ~1.36M, against 529 x 67² = 2.38M today
//
// So near-field detail doubles while boot work drops ~43%. Differing resolutions at a shared edge
// would open T-junction cracks, which is exactly what run 355 / ADR-0301's per-chunk skirts already
// close — this run is the reason those exist.
const DESKTOP_TERRAIN_LOD_SEGMENTS_RUN356 = Object.freeze({ NEAR: 128, MID: 64, FAR: 32 });
const DESKTOP_TERRAIN_LOD_BANDS_RUN356 = Object.freeze({ NEAR_MAX_CHUNKS: 2, MID_MAX_CHUNKS: 5 });
/** Chunks beyond this Chebyshev radius of the streaming center are left at whatever band they were
 * built in. They are already `FAR`, which is the correct band for them, and skipping them keeps a
 * boundary crossing from walking all 529+ resident desktop chunks. */
const DESKTOP_TERRAIN_LOD_REGRADE_RADIUS_RUN356 = 6;
/** Same live-world discriminator run 140 established: `sceneManager.js` is the only caller that
 * supplies the full settlement flatten-pad set, so generic and test-constructed managers keep the
 * uniform `this.segments` behaviour their existing regression contracts assert. */
const DESKTOP_TERRAIN_LOD_MIN_FLATTEN_PADS_RUN356 = 14;

function isLiveDesktopWorldManagerRun356(manager) {
	return !isMobileCoarsePointerRun134() &&
		Array.isArray(manager.flattenPads) &&
		manager.flattenPads.length >= DESKTOP_TERRAIN_LOD_MIN_FLATTEN_PADS_RUN356;
}

function desktopTerrainLodSegmentsRun356(chunkX, chunkZ, centerX, centerZ) {
	const distance = Math.max(Math.abs(chunkX - centerX), Math.abs(chunkZ - centerZ));
	if (distance <= DESKTOP_TERRAIN_LOD_BANDS_RUN356.NEAR_MAX_CHUNKS) return DESKTOP_TERRAIN_LOD_SEGMENTS_RUN356.NEAR;
	if (distance <= DESKTOP_TERRAIN_LOD_BANDS_RUN356.MID_MAX_CHUNKS) return DESKTOP_TERRAIN_LOD_SEGMENTS_RUN356.MID;
	return DESKTOP_TERRAIN_LOD_SEGMENTS_RUN356.FAR;
}

function createDesktopTerrainLodChunkRun356(manager, chunkX, chunkZ, segments) {
	const mesh = createTerrainChunk({
		chunkX,
		chunkZ,
		size: manager.chunkSizeMeters,
		segments,
		seed: manager.seed,
		flattenPads: manager.flattenPads,
		roadCorridor: manager.roadCorridor,
	});
	mesh.userData.desktopTerrainLodSegmentsRun356 = segments;
	return mesh;
}

const _loadChunkBeforeDesktopTerrainLodRun356 = ChunkManager.prototype.loadChunk;
ChunkManager.prototype.loadChunk = function loadChunkWithDesktopTerrainLodRun356(chunkX, chunkZ) {
	if (!isLiveDesktopWorldManagerRun356(this)) return _loadChunkBeforeDesktopTerrainLodRun356.call(this, chunkX, chunkZ);
	const key = chunkKey(chunkX, chunkZ);
	const existing = this.loaded.get(key);
	if (existing) return existing;
	const center = this.desktopTerrainLodCenterRun356 ?? { x: 0, z: 0 };
	const mesh = createDesktopTerrainLodChunkRun356(this, chunkX, chunkZ, desktopTerrainLodSegmentsRun356(chunkX, chunkZ, center.x, center.z));
	this.scene.add(mesh);
	this.loaded.set(key, mesh);
	this.everGenerated.add(key);
	return mesh;
};

const _loadSquareBeforeDesktopTerrainLodRun356 = ChunkManager.prototype.loadSquare;
ChunkManager.prototype.loadSquare = function loadSquareWithDesktopTerrainLodRun356(centerX, centerZ, radius) {
	if (isLiveDesktopWorldManagerRun356(this)) this.desktopTerrainLodCenterRun356 = { x: centerX, z: centerZ };
	return _loadSquareBeforeDesktopTerrainLodRun356.call(this, centerX, centerZ, radius);
};

const _streamTowardsBeforeDesktopTerrainLodRun356 = ChunkManager.prototype.streamTowards;
ChunkManager.prototype.streamTowards = function streamTowardsWithDesktopTerrainLodRun356(centerChunkX, centerChunkZ, radius) {
	if (!isLiveDesktopWorldManagerRun356(this)) {
		return _streamTowardsBeforeDesktopTerrainLodRun356.call(this, centerChunkX, centerChunkZ, radius);
	}
	this.desktopTerrainLodCenterRun356 = { x: centerChunkX, z: centerChunkZ };
	_streamTowardsBeforeDesktopTerrainLodRun356.call(this, centerChunkX, centerChunkZ, radius);

	for (const [key, mesh] of [...this.loaded.entries()]) {
		const [chunkX, chunkZ] = key.split(',').map(Number);
		if (Math.max(Math.abs(chunkX - centerChunkX), Math.abs(chunkZ - centerChunkZ)) > DESKTOP_TERRAIN_LOD_REGRADE_RADIUS_RUN356) continue;
		const desiredSegments = desktopTerrainLodSegmentsRun356(chunkX, chunkZ, centerChunkX, centerChunkZ);
		if (mesh.userData.desktopTerrainLodSegmentsRun356 === desiredSegments) continue;
		const replacement = createDesktopTerrainLodChunkRun356(this, chunkX, chunkZ, desiredSegments);
		this.scene.remove(mesh);
		disposeTerrainChunk(mesh);
		this.scene.add(replacement);
		this.loaded.set(key, replacement);
	}
};
