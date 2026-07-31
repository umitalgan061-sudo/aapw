/**
 * Procedural terrain chunk generation: seeded value noise + fractal Brownian motion (FBM),
 * baked into a displaced/vertex-colored `PlaneGeometry` per chunk. No external heightmap images
 * or textures — this is deliberately "geography first, polish later" (see 3D_GAME_PROGRESS.md's
 * World Coverage section): cheap enough to generate hundreds of chunks, detail arrives later.
 *
 * Chunk grid convention (shared with `CHUNK_CONFIG` in `config.js`): chunk `(chunkX, chunkZ)` is
 * centered at world position `(chunkX * size, 0, chunkZ * size)`, so chunk `(0, 0)` sits centered
 * on the world origin. A future chunk-manager/streaming system should reuse this convention
 * rather than inventing another one.
 * @module world/terrain
 */

import * as THREE from 'three';

/**
 * Deterministic 32-bit PRNG (mulberry32). Never use `Math.random()` for world generation — see
 * the project's determinism rule: same seed + same config must always produce the same world.
 * Exported so other world-generation modules (`world/rivers.js`) reuse this exact implementation
 * instead of a second, potentially-drifting copy of the same algorithm.
 * @param {number} seed
 * @returns {() => number} Returns a function producing floats in [0, 1).
 */
export function mulberry32(seed) {
	let a = seed >>> 0;
	return function random() {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

const LATTICE_SIZE = 256;
const LATTICE_MASK = LATTICE_SIZE - 1;

/**
 * Builds a seeded 2D value-noise function (smoothly interpolated hashed lattice values, in the
 * classic "value noise" family — simpler than gradient/Perlin noise but sufficient for terrain
 * FBM at this project's current fidelity target).
 * @param {number} seed
 * @returns {(x: number, y: number) => number} Noise in [0, 1), continuous over x/y.
 */
function createValueNoise2D(seed) {
	const random = mulberry32(seed);
	const permutation = new Uint8Array(LATTICE_SIZE);
	for (let i = 0; i < LATTICE_SIZE; i++) permutation[i] = i;
	for (let i = LATTICE_SIZE - 1; i > 0; i--) {
		const j = Math.floor(random() * (i + 1));
		const tmp = permutation[i];
		permutation[i] = permutation[j];
		permutation[j] = tmp;
	}

	const hash = (ix, iy) => permutation[(permutation[ix & LATTICE_MASK] + iy) & LATTICE_MASK];
	const latticeValue = (ix, iy) => hash(ix, iy) / LATTICE_MASK;
	const smoothstep = (t) => t * t * (3 - 2 * t);

	return function noise2D(x, y) {
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const sx = smoothstep(x - x0);
		const sy = smoothstep(y - y0);
		const n00 = latticeValue(x0, y0);
		const n10 = latticeValue(x0 + 1, y0);
		const n01 = latticeValue(x0, y0 + 1);
		const n11 = latticeValue(x0 + 1, y0 + 1);
		const nx0 = n00 + (n10 - n00) * sx;
		const nx1 = n01 + (n11 - n01) * sx;
		return nx0 + (nx1 - nx0) * sy;
	};
}

/**
 * Fractal Brownian motion: sums several octaves of `noise2D` at increasing frequency and
 * decreasing amplitude for natural-looking, multi-scale terrain instead of one smooth bump field.
 * @param {(x: number, y: number) => number} noise2D
 * @param {number} x
 * @param {number} y
 * @param {{octaves?: number, lacunarity?: number, gain?: number}} [options]
 * @returns {number} Normalized to [0, 1).
 */
function fbm2D(noise2D, x, y, { octaves = 5, lacunarity = 2, gain = 0.5 } = {}) {
	let amplitude = 1;
	let frequency = 1;
	let sum = 0;
	let maxAmplitude = 0;
	for (let i = 0; i < octaves; i++) {
		sum += noise2D(x * frequency, y * frequency) * amplitude;
		maxAmplitude += amplitude;
		amplitude *= gain;
		frequency *= lacunarity;
	}
	return sum / maxAmplitude;
}

const LOW_COLOR = new THREE.Color(0x3d6b28);
const HIGH_COLOR = new THREE.Color(0x6b6152);
/** Exponent applied to the clamped low/high blend fraction before it drives the `LOW_COLOR`->
 * `HIGH_COLOR` lerp (see `createTerrainChunk`). >1 biases the curve toward `LOW_COLOR` (grass) —
 * a vertex needs a higher fraction of `maxHeightMeters` before rock starts blending in, so grass
 * reads as the dominant color across more of the height range instead of a linear 50/50 split. */
const HEIGHT_COLOR_BLEND_EXPONENT = 1.5;
/** World-units-per-noise-cell; tuned by eye so a single chunk shows a few rolling hills, not one giant bump or pure static. */
const NOISE_SCALE = 0.006;
/** Default peak height variation, in meters. Exported so callers that need to sample this same
 * height field outside a chunk (e.g. `world/rivers.js` tracing a downhill flow path) use the exact
 * same scale terrain chunks are generated at, instead of a second, potentially-drifting constant. */
export const DEFAULT_MAX_HEIGHT_METERS = 24;

/**
 * Builds a pure, stateless world-space height sampler for a given seed — the same FBM formula
 * `createTerrainChunk` bakes into chunk geometry, exposed standalone so other systems can query
 * "how tall is the terrain at this exact point" without generating a whole chunk. Determinism
 * guarantee: same `(worldX, worldZ, seed, maxHeightMeters)` always returns the same height, and
 * matches whatever `createTerrainChunk` would bake at that point (both derive from the same
 * `noise2D`/`fbm2D` calls) — used by `world/rivers.js` to trace a path over the *actual* terrain
 * a chunk would render, not an approximation of it.
 * @param {number} seed
 * @param {{octaves?: number, lacunarity?: number, gain?: number}} [fbmOptions] Forwarded to
 *   `fbm2D`. Default (5 octaves, matching `createTerrainChunk`) is what chunk geometry actually
 *   renders; a caller that needs the terrain's *macro* shape without its finest bumps (e.g.
 *   `world/rivers.js` picking a downhill flow direction — see DECISIONS.md ADR-0009 for why) can
 *   pass fewer octaves for a low-pass-filtered version of the same underlying noise field.
 * @returns {(worldX: number, worldZ: number, maxHeightMeters?: number) => number}
 */
export function createHeightSampler(seed, fbmOptions) {
	const noise2D = createValueNoise2D(seed);
	return function sampleHeightMeters(worldX, worldZ, maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS) {
		return fbm2D(noise2D, worldX * NOISE_SCALE, worldZ * NOISE_SCALE, fbmOptions) * maxHeightMeters;
	};
}

/**
 * Generates one terrain chunk: a displaced, vertex-colored ground mesh, deterministic for a
 * given `(chunkX, chunkZ, seed)`. Height and color both derive from the same FBM sample so low
 * ground reads as grass and high ground reads as bare rock, with no separate texture needed yet.
 * @param {object} options
 * @param {number} options.chunkX Chunk grid column (see module-level grid convention above).
 * @param {number} options.chunkZ Chunk grid row.
 * @param {number} [options.size=500] Chunk edge length in meters.
 * @param {number} [options.segments=64] Geometry subdivisions per edge (resolution).
 * @param {number} [options.maxHeightMeters] Peak height variation within the chunk (`DEFAULT_MAX_HEIGHT_METERS`).
 * @param {number} [options.seed=1] World seed — same seed + same args always produce the same chunk.
 * @returns {THREE.Mesh} Positioned at the chunk's world-space center, ready to `scene.add()`.
 */
export function createTerrainChunk({ chunkX, chunkZ, size = 500, segments = 64, maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS, seed = 1 }) {
	const sampleHeightMeters = createHeightSampler(seed);
	const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
	geometry.rotateX(-Math.PI / 2);

	const position = geometry.attributes.position;
	const colors = new Float32Array(position.count * 3);
	const blended = new THREE.Color();

	for (let i = 0; i < position.count; i++) {
		const worldX = chunkX * size + position.getX(i);
		const worldZ = chunkZ * size + position.getZ(i);
		const y = sampleHeightMeters(worldX, worldZ, maxHeightMeters);
		position.setY(i, y);

		// Clamp before the curve: `sampleHeightMeters` is mathematically bounded to [0, maxHeightMeters)
		// by the FBM's own weighted-average-of-noise-in-[0,1) construction, but nothing upstream
		// *guarantees* that for every future noise function/octave config, and an unclamped fraction
		// here would let `THREE.Color.lerp` extrapolate past LOW_COLOR/HIGH_COLOR into unintended hues.
		const heightFraction = THREE.MathUtils.clamp(y / maxHeightMeters, 0, 1);
		blended.copy(LOW_COLOR).lerp(HIGH_COLOR, Math.pow(heightFraction, HEIGHT_COLOR_BLEND_EXPONENT));
		colors[i * 3] = blended.r;
		colors[i * 3 + 1] = blended.g;
		colors[i * 3 + 2] = blended.b;
	}
	position.needsUpdate = true;
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.computeVertexNormals();

	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.position.set(chunkX * size, 0, chunkZ * size);
	mesh.userData.chunkCoord = { x: chunkX, z: chunkZ };
	mesh.userData.areaKm2 = (size * size) / 1_000_000;
	return mesh;
}

/**
 * Disposes a mesh created by `createTerrainChunk` (geometry + material). Call on chunk unload —
 * see the project's memory-leak checklist.
 * @param {THREE.Mesh} chunkMesh
 */
export function disposeTerrainChunk(chunkMesh) {
	chunkMesh.geometry.dispose();
	chunkMesh.material.dispose();
}
