/**
 * Render-only micro-PBR surface layer for terrain: a tiny, exactly-tileable normal + roughness atlas
 * generated once and shared by every chunk material.
 *
 * Extracted from `world/terrain.js` on 2026-08-19 when that file crossed the 600-line cap
 * (GOVERNANCE.md Altin Kural 7). Pure move — no behaviour change, no constant changed. `terrain.js`
 * re-exports this module's public names so every existing importer and regression check keeps working
 * against the same API.
 *
 * This is deliberately not geography: canonical height, coastline, hydrology, placement and collision
 * are untouched. The atlas is addressed through a second UV channel whose phase comes directly from
 * world metres, so 22 m means 22 m everywhere and neighbouring chunks cannot restart the pattern at
 * their shared border.
 * @module world/terrainMicroSurface
 */

import * as THREE from 'three';

const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

/**
 * Render-only micro PBR layer. This is deliberately not geography: canonical height, coastline,
 * hydrology, placement and collision stay unchanged. The normal/roughness atlas uses a second UV
 * channel whose phase is derived directly from world metres, so 22 m means 22 m everywhere and
 * neighboring chunks cannot restart the detail pattern at their border.
 */
export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	id: 'terrain-micro-surface-world-uv-pbr-v2',
	textureSize: 128,
	detailRepeatMeters: 32,
	normalStrength: 0.42,
	normalSlopeGain: 1.8,
	roughnessBase: 0.96,
	roughnessMin: 0.82,
	roughnessMax: 0.98,
	uvChannel: 1,
	maxAnisotropy: 4,
	renderOnly: true,
});

/** Stable metre-space UV for the render-only detail channel. Negative UV is valid with RepeatWrapping. */
export function terrainMicroUvAt(worldX, worldZ) {
	const repeatMeters = TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters;
	return Object.freeze({ u: worldX / repeatMeters, v: worldZ / repeatMeters });
}

function terrainDetailHeight(u, v) {
	// Integer spatial frequencies make the atlas itself exactly tileable at every edge.
	return (
		0.34 * Math.sin(TAU * (3 * u + 5 * v) + 0.41)
		+ 0.22 * Math.cos(TAU * (7 * u - 4 * v) + 1.73)
		+ 0.16 * Math.sin(TAU * (11 * u + 13 * v) + 2.19)
		+ 0.11 * Math.cos(TAU * (19 * u - 17 * v) + 0.87)
		+ 0.09 * Math.sin(TAU * (29 * u + 23 * v) + 2.81)
		+ 0.08 * Math.cos(TAU * (37 * u - 31 * v) + 1.21)
	);
}

function buildTerrainDetailField(size) {
	const field = new Float32Array(size * size);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) field[y * size + x] = terrainDetailHeight(x / size, y / size);
	}
	return field;
}

function wrappedTerrainDetailSample(field, size, x, y) {
	return field[((y + size) % size) * size + ((x + size) % size)];
}

function buildTerrainNormalData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const gain = TERRAIN_MICRO_SURFACE_POLICY.normalSlopeGain;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const dx = (wrappedTerrainDetailSample(field, size, x + 1, y) - wrappedTerrainDetailSample(field, size, x - 1, y)) * gain;
			const dy = (wrappedTerrainDetailSample(field, size, x, y + 1) - wrappedTerrainDetailSample(field, size, x, y - 1)) * gain;
			const inverseLength = 1 / Math.hypot(dx, dy, 1);
			const offset = (y * size + x) * 4;
			data[offset] = Math.round((-dx * inverseLength * 0.5 + 0.5) * 255);
			data[offset + 1] = Math.round((-dy * inverseLength * 0.5 + 0.5) * 255);
			data[offset + 2] = Math.round((inverseLength * 0.5 + 0.5) * 255);
			data[offset + 3] = 255;
		}
	}
	return data;
}

function buildTerrainRoughnessData(field, size) {
	const data = new Uint8Array(size * size * 4);
	const { roughnessMin, roughnessMax } = TERRAIN_MICRO_SURFACE_POLICY;
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const center = wrappedTerrainDetailSample(field, size, x, y);
			const dx = Math.abs(wrappedTerrainDetailSample(field, size, x + 1, y) - wrappedTerrainDetailSample(field, size, x - 1, y));
			const dy = Math.abs(wrappedTerrainDetailSample(field, size, x, y + 1) - wrappedTerrainDetailSample(field, size, x, y - 1));
			const grain = clamp01(0.5 + center * 0.28 + Math.hypot(dx, dy) * 0.9);
			const encoded = Math.round(clamp01(lerp(roughnessMin, roughnessMax, grain)) * 255);
			const offset = (y * size + x) * 4;
			data[offset] = encoded;
			data[offset + 1] = encoded;
			data[offset + 2] = encoded;
			data[offset + 3] = 255;
		}
	}
	return data;
}

function configureTerrainDataTexture(texture, name) {
	texture.name = name;
	texture.wrapS = THREE.RepeatWrapping;
	texture.wrapT = THREE.RepeatWrapping;
	texture.repeat.set(1, 1);
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = TERRAIN_MICRO_SURFACE_POLICY.maxAnisotropy;
	texture.colorSpace = THREE.NoColorSpace;
	texture.channel = TERRAIN_MICRO_SURFACE_POLICY.uvChannel;
	texture.userData = {
		...texture.userData,
		terrainMicroSurfacePolicy: TERRAIN_MICRO_SURFACE_POLICY.id,
		worldSpaceRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
	};
	texture.needsUpdate = true;
	return texture;
}

let sharedTerrainMicroSurface = null;

/** Two tiny app-lifetime maps shared by every chunk; geometry density and canonical height are unchanged. */
export function getSharedTerrainMicroSurfaceTextures() {
	if (sharedTerrainMicroSurface) return sharedTerrainMicroSurface;
	const size = TERRAIN_MICRO_SURFACE_POLICY.textureSize;
	const field = buildTerrainDetailField(size);
	const normalMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainNormalData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-normal-v2',
	);
	const roughnessMap = configureTerrainDataTexture(
		new THREE.DataTexture(buildTerrainRoughnessData(field, size), size, size, THREE.RGBAFormat, THREE.UnsignedByteType),
		'terrain-world-micro-roughness-v2',
	);
	sharedTerrainMicroSurface = Object.freeze({ normalMap, roughnessMap });
	return sharedTerrainMicroSurface;
}

export function applyTerrainMicroSurface(material) {
	if (!material?.isMeshStandardMaterial) throw new TypeError('terrain micro-surface requires MeshStandardMaterial');
	const surface = getSharedTerrainMicroSurfaceTextures();
	material.normalMap = surface.normalMap;
	material.normalMapType = THREE.TangentSpaceNormalMap;
	material.normalScale.setScalar(TERRAIN_MICRO_SURFACE_POLICY.normalStrength);
	material.roughnessMap = surface.roughnessMap;
	material.roughness = TERRAIN_MICRO_SURFACE_POLICY.roughnessBase;
	material.userData.terrainMicroSurface = Object.freeze({
		policyId: TERRAIN_MICRO_SURFACE_POLICY.id,
		detailRepeatMeters: TERRAIN_MICRO_SURFACE_POLICY.detailRepeatMeters,
		uvChannel: TERRAIN_MICRO_SURFACE_POLICY.uvChannel,
		renderOnly: true,
	});
	material.needsUpdate = true;
	return material;
}