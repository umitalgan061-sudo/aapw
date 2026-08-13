/**
 * Procedural terrain chunk generation: seeded value noise + FBM, plus validated authored-surface
 * parity adapters. Chunk and gameplay height queries share createHeightSampler, so render/physics
 * cannot silently drift apart.
 * @module world/terrain
 */

import * as THREE from 'three';
import { applyG07Terrain3dRuntimeParity } from './g07Terrain3dRuntimeParity.js';

/** Deterministic 32-bit PRNG (mulberry32). */
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

/**
 * Existing macro relief stays byte-equivalent to the pre-parity field. Authored parity is applied
 * only after this legacy field (and any settlement flatten pad) has been evaluated.
 */
const MACRO_RELIEF_FEATURES = Object.freeze([
	Object.freeze({ x: 2600, z: 2200, radiusMeters: 1300, amplitudeMeters: 150 }),
	Object.freeze({ x: 3400, z: 4200, radiusMeters: 500, amplitudeMeters: 45 }),
	Object.freeze({ x: 3000, z: 700, radiusMeters: 550, amplitudeMeters: 40 }),
]);

function sampleMacroReliefMeters(worldX, worldZ) {
	let total = 0;
	for (const feature of MACRO_RELIEF_FEATURES) {
		const distance = Math.hypot(worldX - feature.x, worldZ - feature.z);
		if (distance >= feature.radiusMeters) continue;
		const t = 1 - distance / feature.radiusMeters;
		const eased = t * t * (3 - 2 * t);
		total += feature.amplitudeMeters * eased;
	}
	return total;
}

function computeFlattenWeight(distanceMeters, innerRadiusMeters, outerRadiusMeters) {
	if (distanceMeters <= innerRadiusMeters) return 1;
	if (distanceMeters >= outerRadiusMeters) return 0;
	const t = 1 - (distanceMeters - innerRadiusMeters) / (outerRadiusMeters - innerRadiusMeters);
	return t * t * (3 - 2 * t);
}

const LOW_COLOR = new THREE.Color(0x3d6b28);
const HIGH_COLOR = new THREE.Color(0x6b6152);
const HEIGHT_COLOR_BLEND_EXPONENT = 1.5;
const NOISE_SCALE = 0.006;
export const DEFAULT_MAX_HEIGHT_METERS = 24;

/**
 * Shared deterministic height sampler. G07's validated Terrain3D LOD0 seabed is applied at the
 * final stage so rendered chunk vertices, physics queries, rivers and settlement-ground sampling
 * all see the same authored result. Outside G07+guard the legacy sampler is numerically unchanged.
 */
export function createHeightSampler(seed, fbmOptions, flattenPads = []) {
	const noise2D = createValueNoise2D(seed);
	return function sampleHeightMeters(worldX, worldZ, maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS) {
		const fineDetailMeters = fbm2D(noise2D, worldX * NOISE_SCALE, worldZ * NOISE_SCALE, fbmOptions) * maxHeightMeters;
		const baseHeightMeters = fineDetailMeters + sampleMacroReliefMeters(worldX, worldZ);
		let legacyHeightMeters = baseHeightMeters;

		if (flattenPads.length > 0) {
			let strongestWeight = 0;
			let strongestAnchorMeters = 0;
			for (const pad of flattenPads) {
				const distanceMeters = Math.hypot(worldX - pad.x, worldZ - pad.z);
				if (distanceMeters >= pad.outerRadiusMeters) continue;
				const weight = computeFlattenWeight(distanceMeters, pad.innerRadiusMeters, pad.outerRadiusMeters);
				if (weight > strongestWeight) {
					strongestWeight = weight;
					strongestAnchorMeters = pad.anchorHeightMeters;
				}
			}
			if (strongestWeight > 0) {
				legacyHeightMeters = baseHeightMeters + (strongestAnchorMeters - baseHeightMeters) * strongestWeight;
			}
		}

		return applyG07Terrain3dRuntimeParity(legacyHeightMeters, worldX, worldZ);
	};
}

/** Create one deterministic displaced/vertex-colored terrain chunk. */
export function createTerrainChunk({
	chunkX,
	chunkZ,
	size = 500,
	segments = 64,
	maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS,
	seed = 1,
	flattenPads = [],
}) {
	const sampleHeightMeters = createHeightSampler(seed, undefined, flattenPads);
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

/** Dispose a terrain chunk's GPU resources on unload. */
export function disposeTerrainChunk(chunkMesh) {
	chunkMesh.geometry.dispose();
	chunkMesh.material.dispose();
}
