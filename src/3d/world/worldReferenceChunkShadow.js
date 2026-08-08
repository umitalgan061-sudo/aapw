/**
 * Opt-in scene/chunk integration surface for canonical full-reference terrain qualification.
 *
 * Run 186 proved the canonical hydrology adapter numerically over the full 96x64 owner-map mask.
 * Run 187 takes the next deliberately non-live step: bake that sampler into real THREE.PlaneGeometry
 * terrain chunks, pair it with the existing water plane, and expose a collider facade backed by the
 * exact same sampler. Nothing in the live scene/chunk/gameplay import graph consumes this module.
 * @module world/worldReferenceChunkShadow
 */

import * as THREE from 'three';

const SHADOW_WATERBED_COLOR = new THREE.Color(0x173a43);
const SHADOW_LOWLAND_COLOR = new THREE.Color(0x3d6b28);
const SHADOW_HIGHLAND_COLOR = new THREE.Color(0x6b6152);

function assertFinite(value, label) {
	if (!Number.isFinite(value)) throw new TypeError(`${label} must be finite`);
}

function assertPositive(value, label) {
	assertFinite(value, label);
	if (value <= 0) throw new RangeError(`${label} must be > 0`);
}

function assertSampler(sampleHeightMeters) {
	if (typeof sampleHeightMeters !== 'function') throw new TypeError('sampleHeightMeters must be a function');
}

/**
 * Bakes one real renderable terrain mesh from an arbitrary deterministic height sampler. The shape
 * intentionally mirrors the proven terrain chunk convention (chunk center = chunkIndex * size,
 * PlaneGeometry rotated onto XZ, vertex heights sampled in world space) without modifying the live
 * `createTerrainChunk` API before the migration is approved.
 */
export function createCanonicalTerrainShadowChunk({
	chunkX,
	chunkZ,
	sampleHeightMeters,
	seaLevelMeters,
	size = 500,
	segments = 64,
}) {
	assertFinite(chunkX, 'chunkX');
	assertFinite(chunkZ, 'chunkZ');
	assertFinite(seaLevelMeters, 'seaLevelMeters');
	assertPositive(size, 'size');
	assertPositive(segments, 'segments');
	assertSampler(sampleHeightMeters);

	const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
	geometry.rotateX(-Math.PI / 2);
	const position = geometry.getAttribute('position');
	const colors = new Float32Array(position.count * 3);
	const color = new THREE.Color();
	let minHeightMeters = Infinity;
	let maxHeightMeters = -Infinity;
	let submergedVertexCount = 0;

	for (let index = 0; index < position.count; index += 1) {
		const worldX = chunkX * size + position.getX(index);
		const worldZ = chunkZ * size + position.getZ(index);
		const height = sampleHeightMeters(worldX, worldZ);
		assertFinite(height, 'sampleHeightMeters result');
		position.setY(index, height);
		minHeightMeters = Math.min(minHeightMeters, height);
		maxHeightMeters = Math.max(maxHeightMeters, height);

		if (height < seaLevelMeters) {
			submergedVertexCount += 1;
			color.copy(SHADOW_WATERBED_COLOR);
		} else {
			const landBlend = THREE.MathUtils.clamp((height - seaLevelMeters) / 18, 0, 1);
			color.copy(SHADOW_LOWLAND_COLOR).lerp(SHADOW_HIGHLAND_COLOR, landBlend);
		}
		colors[index * 3] = color.r;
		colors[index * 3 + 1] = color.g;
		colors[index * 3 + 2] = color.b;
	}

	position.needsUpdate = true;
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();

	const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
	const mesh = new THREE.Mesh(geometry, material);
	mesh.name = `canonical-terrain-shadow-${chunkX},${chunkZ}`;
	mesh.position.set(chunkX * size, 0, chunkZ * size);
	mesh.userData.chunkCoord = Object.freeze({ x: chunkX, z: chunkZ });
	mesh.userData.areaKm2 = (size * size) / 1_000_000;
	mesh.userData.canonicalTerrainShadowRun187 = Object.freeze({
		segments,
		vertexCount: position.count,
		minHeightMeters,
		maxHeightMeters,
		submergedVertexCount,
	});
	return mesh;
}

/**
 * Physics-shadow facade for the exact same sampler that generated the geometry. This deliberately
 * matches `physics.js`'s public `getGroundHeight(x,z)` shape so integration checks can prove visual
 * terrain and collision source agree before any live collider wiring changes.
 */
export function createCanonicalGroundShadowCollider(sampleHeightMeters) {
	assertSampler(sampleHeightMeters);
	return Object.freeze({
		getGroundHeight(worldX, worldZ) {
			assertFinite(worldX, 'worldX');
			assertFinite(worldZ, 'worldZ');
			const height = sampleHeightMeters(worldX, worldZ);
			assertFinite(height, 'sampleHeightMeters result');
			return height;
		},
	});
}

/** Dispose every GPU resource allocated by `createCanonicalTerrainShadowChunk`. */
export function disposeCanonicalTerrainShadowChunk(mesh) {
	if (!mesh) return;
	mesh.geometry?.dispose?.();
	if (Array.isArray(mesh.material)) mesh.material.forEach((material) => material?.dispose?.());
	else mesh.material?.dispose?.();
}
