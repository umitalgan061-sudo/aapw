import * as THREE from 'three';

/**
 * Render-only micro-surface policy for shipped terrain.
 * It changes lighting response, never canonical height, hydrology, placement or collision authority.
 */
export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	id: 'terrain-micro-surface-pbr-v1',
	textureSize: 128,
	detailRepeatMeters: 22,
	normalStrength: 0.72,
	normalSlopeGain: 3.4,
	roughnessBase: 0.96,
	roughnessMin: 0.68,
	roughnessMax: 0.98,
	maxAnisotropy: 8,
});

const surfaceCache = new Map();
const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));

function terrainDetailHeight(u, v) {
	// Integer spatial frequencies keep every octave exactly tileable at the atlas boundary.
	return (
		0.34 * Math.sin(TAU * (3 * u + 5 * v) + 0.41)
		+ 0.22 * Math.cos(TAU * (7 * u - 4 * v) + 1.73)
		+ 0.16 * Math.sin(TAU * (11 * u + 13 * v) + 2.19)
		+ 0.11 * Math.cos(TAU * (19 * u - 17 * v) + 0.87)
		+ 0.09 * Math.sin(TAU * (29 * u + 23 * v) + 2.81)
		+ 0.08 * Math.cos(TAU * (37 * u - 31 * v) + 1.21)
	);
}

function buildHeightField(size) {
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			field[y * size + x] = terrainDetailHeight(x / size, y / size);
		}
	}
	return field;
}

function wrappedSample(field, size, x, y) {
	const wrappedX = (x + size) % size;
	const wrappedY = (y + size) % size;
	return field[wrappedY * size + wrappedX];
}

function buildNormalData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const gain = TERRAIN_MICRO_SURFACE_POLICY.normalSlopeGain;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const dx = (wrappedSample(field, size, x + 1, y) - wrappedSample(field, size, x - 1, y)) * gain;
			const dy = (wrappedSample(field, size, x, y + 1) - wrappedSample(field, size, x, y - 1)) * gain;
			const inverseLength = 1 / Math.hypot(dx, dy, 1);
			const nx = -dx * inverseLength;
			const ny = -dy * inverseLength;
			const nz = inverseLength;
			const offset = (y * size + x) * 4;
			data[offset] = Math.round((nx * 0.5 + 0.5) * 255);
			data[offset + 1] = Math.round((ny * 0.5 + 0.5) * 255);
			data[offset + 2] = Math.round((nz * 0.5 + 0.5) * 255);
			data[offset + 3] = 255;
		}
	}
	return data;
}

function buildRoughnessData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const { roughnessMin, roughnessMax } = TERRAIN_MICRO_SURFACE_POLICY;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const center = wrappedSample(field, size, x, y);
			const dx = Math.abs(wrappedSample(field, size, x + 1, y) - wrappedSample(field, size, x - 1, y));
			const dy = Math.abs(wrappedSample(field, size, x, y + 1) - wrappedSample(field, size, x, y - 1));
			const grain = clamp01(0.5 + center * 0.28 + Math.hypot(dx, dy) * 0.9);
			const roughness = THREE.MathUtils.lerp(roughnessMin, roughnessMax, grain);
			const encoded = Math.round(clamp01(roughness) * 255);
			const offset = (y * size + x) * 4;
			data[offset] = encoded;
			data[offset + 1] = encoded;
			data[offset + 2] = encoded;
			data[offset + 3] = 255;
		}
	}
	return data;
}

function configureDataTexture(texture, repeatCount) {
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(repeatCount, repeatCount);
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = TERRAIN_MICRO_SURFACE_POLICY.maxAnisotropy;
	texture.colorSpace = THREE.NoColorSpace;
	texture.needsUpdate = true;
	return texture;
}

function createSurfaceTextures(chunkSizeMeters) {
	const size = TERRAIN_MICRO_SURFACE_POLICY.textureSize;
	const repeatCount = chunkSizeMeters / TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters;
	const field = buildHeightField(size);
	const normalMap = configureDataTexture(
		new THREE.DataTexture(buildNormalData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		repeatCount,
	);
	const roughnessMap = configureDataTexture(
		new THREE.DataTexture(buildRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		repeatCount,
	);
	normalMap.name = 'terrain-micro-normal-v1';
	roughnessMap.name = 'terrain-micro-roughness-v1';
	return Object.freeze({ normalMap, roughnessMap, repeatCount });
}

function getSurfaceTextures(chunkSizeMeters) {
	const cacheKey = Number(chunkSizeMeters.toFixed(3));
	if (!surfaceCache.has(cacheKey)) surfaceCache.set(cacheKey, createSurfaceTextures(chunkSizeMeters));
	return surfaceCache.get(cacheKey);
}

/** Apply physically small-scale detail without touching geometry or world-space source authority. */
export function applyTerrainMicroSurface(material, { chunkSizeMeters = 500 } = {}) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('terrain micro-surface requires MeshStandardMaterial');
	if (!Number.isFinite(chunkSizeMeters) || chunkSizeMeters <= 0) throw new RangeError('chunkSizeMeters must be positive');
	const surface = getSurfaceTextures(chunkSizeMeters);
	material.normalMap = surface.normalMap;
	material.normalMapType = THREE.TangentSpaceNormalMap;
	material.normalScale.setScalar(TERRAIN_MICRO_SURFACE_POLICY.normalStrength);
	material.roughnessMap = surface.roughnessMap;
	material.roughness = TERRAIN_MICRO_SURFACE_POLICY.roughnessBase;
	material.userData.terrainMicroSurface = Object.freeze({
		policyId: TERRAIN_MICRO_SURFACE_POLICY.id,
		detailRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
		repeatCount: surface.repeatCount,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}
