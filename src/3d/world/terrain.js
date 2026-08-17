/**
 * Shipped full-owner-map terrain source.
 *
 * The historical seeded FBM field is no longer production height authority. Every renderer,
 * collider, river, road, settlement and vegetation consumer already imports this module, so the
 * module itself now projects world coordinates onto the canonical 9000x7000 owner map and derives
 * one deterministic height from the source-anchored Pindex V2 surface, biome and relief fields.
 * GeoCell/Pindex grids remain classification/addressing inputs only; no cell edge is a height term.
 * @module world/terrain
 */

import * as THREE from 'three';
import { WORLD_DEFAULTS, WORLD_SCALE } from '../config.js';
import { WORLD_REFERENCE_ALIGNMENT } from './worldReferenceAlignment.js';
import { referenceProtectionRadiiFromMeters, sampleSeatSafeReferenceHydrology } from './worldReferenceHydrology.js';
import { sampleReferencePindexQualityV2 } from './worldReferenceSurfacePindexes.js';
import { sampleWorldReferenceMountainReliefMeters } from './worldReferenceMountainRelief.js';

export const DEFAULT_MAX_HEIGHT_METERS = 24; // compatibility only; production height is map-derived.
const SEA_LEVEL = WORLD_DEFAULTS.WATER_LEVEL_METERS;
const MAP_WIDTH = WORLD_REFERENCE_ALIGNMENT.mapCanvasWidthUnits;
const MAP_HEIGHT = WORLD_REFERENCE_ALIGNMENT.mapCanvasHeightUnits;
const TAU = Math.PI * 2;
const clamp01 = (value) => Math.max(0, Math.min(1, value));
const lerp = (a, b, t) => a + (b - a) * t;

/** Deterministic PRNG retained for roads/rivers and other established callers. */
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

const PROTECTED_SEAT_MAP_POINTS = Object.freeze([
	[3885, 5370], [1525, 1750], [1185, 4040], [1095, 4040], [1145, 3990], [1750, 3580], [2100, 3270],
	[1610, 4560], [920, 2900], [1850, 2790], [1650, 1060], [1050, 3360], [6190, 5140], [1400, 300],
]);
const PROTECTED_SEATS = Object.freeze(PROTECTED_SEAT_MAP_POINTS.map(([mapX, mapY]) => Object.freeze({
	x: mapX / MAP_WIDTH,
	y: mapY / MAP_HEIGHT,
})));
const PROTECTION_RADII = referenceProtectionRadiiFromMeters(75, WORLD_SCALE.METERS_PER_MAP_UNIT);

export const CURRENT_TERRAIN_POLICY = Object.freeze({
	id: 'westeros-full-owner-map-current-terrain-2026-08-15-v1',
	sourceMapSha256: '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1',
	fullOwnerMapCoverage: true,
	legacyProceduralFallback: false,
	mapDerivedHeight: true,
});

/**
 * Asset-first terrain material policy. `overlay.png` is the authored diffuse source referenced by
 * the repository's `assets/textures/yüzey/model.mtl`; it is not used as a new geography authority.
 * Geography, shoreline, relief and gameplay height remain sourced exclusively from map.png-derived
 * terrain data above. The image is projected once over that same owner-map canvas so chunk borders
 * share identical UVs and never expose a repeated tile grid.
 */
export const CURRENT_TERRAIN_ALBEDO_POLICY = Object.freeze({
	id: 'owner-map-aligned-authored-terrain-albedo-2026-08-17-v1',
	sourceMapSha256: CURRENT_TERRAIN_POLICY.sourceMapSha256,
	assetPath: 'assets/textures/yüzey/overlay/overlay.png',
	sourceMaterialPath: 'assets/textures/yüzey/model.mtl',
	sourceMeshPath: 'assets/textures/yüzey/model.obj',
	mapping: 'full-owner-map-global-uv',
	wrap: 'clamp-to-edge',
	mobileFallback: 'canonical-vertex-color',
	terrainHeightAuthority: CURRENT_TERRAIN_POLICY.id,
});

/**
 * Render-only micro PBR layer. This is deliberately not geography: canonical height, coastline,
 * hydrology, placement and collision stay unchanged. The normal/roughness atlas uses a second UV
 * channel whose phase is derived directly from world metres, so 22 m means 22 m everywhere and
 * neighboring chunks cannot restart the detail pattern at their border.
 */
export const TERRAIN_MICRO_SURFACE_POLICY = Object.freeze({
	id: 'terrain-micro-surface-world-uv-pbr-v2',
	textureSize: 128,
	detailRepeatMeters: 22,
	normalStrength: 0.72,
	normalSlopeGain: 3.4,
	roughnessBase: 0.96,
	roughnessMin: 0.68,
	roughnessMax: 0.98,
	uvChannel: 1,
	maxAnisotropy: 8,
	renderOnly: true,
});

function currentMapPoint(worldX, worldZ) {
	const centerMapX = (WORLD_SCALE.MAP_BOUNDS.minX + WORLD_SCALE.MAP_BOUNDS.maxX) * 0.5;
	const centerMapY = (WORLD_SCALE.MAP_BOUNDS.minY + WORLD_SCALE.MAP_BOUNDS.maxY) * 0.5;
	const rawMapX = worldX / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapX;
	const rawMapY = worldZ / WORLD_SCALE.METERS_PER_MAP_UNIT + centerMapY;
	return Object.freeze({
		nx: clamp01(rawMapX / MAP_WIDTH),
		ny: clamp01(rawMapY / MAP_HEIGHT),
		insideOwnerMap: rawMapX >= 0 && rawMapX <= MAP_WIDTH && rawMapY >= 0 && rawMapY <= MAP_HEIGHT,
	});
}

/**
 * Stable map-space UV query shared by terrain chunks and visual QA. V is flipped because image UV
 * origin is bottom-left while the canonical map canvas is addressed top-down.
 */
export function terrainMapUvAt(worldX, worldZ) {
	const point = currentMapPoint(worldX, worldZ);
	return Object.freeze({ u: point.nx, v: 1 - point.ny, insideOwnerMap: point.insideOwnerMap });
}

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

function canonicalMicroSignal(nx, ny) {
	return 0.50 * Math.sin(TAU * (nx * 13 + ny * 17) + 0.31)
		+ 0.30 * Math.cos(TAU * (nx * 29 - ny * 11) + 1.13)
		+ 0.20 * Math.sin(TAU * (nx * 41 + ny * 37) + 2.07);
}

function sampleCanonicalHeightMeters(worldX, worldZ) {
	const { nx, ny } = currentMapPoint(worldX, worldZ);
	const sample = sampleReferencePindexQualityV2(nx, ny);
	const seaWeight = clamp01(sample.surfaceWeights.sea ?? 0);
	const lakeWeight = clamp01(sample.surfaceWeights.lake ?? 0);
	const waterWeight = clamp01(seaWeight + lakeWeight);
	const rockWeight = clamp01(sample.surfaceWeights.rock ?? 0);
	const snowWeight = clamp01(sample.surfaceWeights.snow ?? 0);
	const micro = canonicalMicroSignal(nx, ny) * (0.45 + sample.microAmplitude * 12);
	const mountainMeters = sampleWorldReferenceMountainReliefMeters(worldX, worldZ);

	const dryRelative = 1.0
		+ sample.reliefInfluence * 28
		+ sample.biomeInfluence * 7
		+ rockWeight * 8
		+ snowWeight * 12
		+ mountainMeters
		+ micro;
	const wetRelative = -3.0 - waterWeight * 5.25 - sample.reliefInfluence * 0.75 + micro * 0.12;
	let heightMeters = SEA_LEVEL + lerp(dryRelative, wetRelative, waterWeight);

	// Keep the Pindex V2 coastal blend continuous. `rawWater` is a semantic QA bit and must not
	// reintroduce a binary height cliff after the continuous surface weights have been evaluated.
	const hydrology = sampleSeatSafeReferenceHydrology(nx, ny, PROTECTED_SEATS, PROTECTION_RADII);
	if (hydrology.protectedLand) {
		const minimumLand = SEA_LEVEL + 0.35 + hydrology.protectedLandWeight * 0.9;
		heightMeters = Math.max(heightMeters, minimumLand);
	}
	return heightMeters;
}

function flattenWeight(distanceMeters, innerRadiusMeters, outerRadiusMeters) {
	if (distanceMeters <= innerRadiusMeters) return 1;
	if (distanceMeters >= outerRadiusMeters) return 0;
	const t = 1 - (distanceMeters - innerRadiusMeters) / (outerRadiusMeters - innerRadiusMeters);
	return t * t * (3 - 2 * t);
}

/**
 * Shared render/physics height sampler. `seed`, `fbmOptions` and `maxHeightMeters` remain accepted
 * for API compatibility, but do not alter the canonical production terrain.
 */
export function createHeightSampler(_seed, _fbmOptions, flattenPads = []) {
	return function sampleHeightMeters(worldX, worldZ, _maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS) {
		const baseHeightMeters = sampleCanonicalHeightMeters(worldX, worldZ);
		let strongestWeight = 0;
		let strongestAnchorMeters = baseHeightMeters;
		for (const pad of flattenPads) {
			const distanceMeters = Math.hypot(worldX - pad.x, worldZ - pad.z);
			const weight = flattenWeight(distanceMeters, pad.innerRadiusMeters, pad.outerRadiusMeters);
			if (weight > strongestWeight) {
				strongestWeight = weight;
				strongestAnchorMeters = pad.anchorHeightMeters;
			}
		}
		return strongestWeight > 0
			? lerp(baseHeightMeters, strongestAnchorMeters, strongestWeight)
			: baseHeightMeters;
	};
}

const LOW_COLOR = new THREE.Color(0x3d6b28);
const HIGH_COLOR = new THREE.Color(0x6b6152);
let sharedTerrainAlbedoTexture = null;
let sharedTerrainAlbedoLoadFailed = false;

function isCoarsePointerDevice() {
	return typeof window !== 'undefined'
		&& typeof window.matchMedia === 'function'
		&& window.matchMedia('(pointer: coarse)').matches;
}

/** One app-lifetime texture shared by every desktop chunk; mobile keeps the proven lightweight path. */
export function getSharedTerrainAlbedoTexture() {
	if (typeof document === 'undefined' || isCoarsePointerDevice() || sharedTerrainAlbedoLoadFailed) return null;
	if (sharedTerrainAlbedoTexture) return sharedTerrainAlbedoTexture;

	const url = new URL('../../../assets/textures/yüzey/overlay/overlay.png', import.meta.url).href;
	const texture = new THREE.TextureLoader().load(
		url,
		undefined,
		undefined,
		() => {
			sharedTerrainAlbedoLoadFailed = true;
			texture.userData.loadFailed = true;
		},
	);
	texture.name = 'owner-map-authored-terrain-albedo';
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	texture.anisotropy = 4;
	texture.userData = {
		...texture.userData,
		terrainAlbedoPolicy: CURRENT_TERRAIN_ALBEDO_POLICY.id,
		repositoryAssetPath: CURRENT_TERRAIN_ALBEDO_POLICY.assetPath,
	};
	sharedTerrainAlbedoTexture = texture;
	return texture;
}

/** Builds one chunk from the exact same sampler used by physics and gameplay. */
export function createTerrainChunk({ chunkX, chunkZ, size = 500, segments = 64, maxHeightMeters = DEFAULT_MAX_HEIGHT_METERS, seed = 1, flattenPads = [] }) {
	const sampleHeightMeters = createHeightSampler(seed, undefined, flattenPads);
	const geometry = new THREE.PlaneGeometry(size, size, segments, segments);
	geometry.rotateX(-Math.PI / 2);
	const position = geometry.attributes.position;
	const uv = geometry.getAttribute('uv');
	const colors = new Float32Array(position.count * 3);
	const microUvs = new Float32Array(position.count * 2);
	const blended = new THREE.Color();
	for (let index = 0; index < position.count; index += 1) {
		const worldX = chunkX * size + position.getX(index);
		const worldZ = chunkZ * size + position.getZ(index);
		const heightMeters = sampleHeightMeters(worldX, worldZ, maxHeightMeters);
		position.setY(index, heightMeters);
		const mapUv = terrainMapUvAt(worldX, worldZ);
		uv.setXY(index, mapUv.u, mapUv.v);
		const microUv = terrainMicroUvAt(worldX, worldZ);
		microUvs[index * 2] = microUv.u;
		microUvs[index * 2 + 1] = microUv.v;
		const fraction = THREE.MathUtils.clamp((heightMeters - SEA_LEVEL) / 80, 0, 1);
		blended.copy(LOW_COLOR).lerp(HIGH_COLOR, fraction);
		colors[index * 3] = blended.r;
		colors[index * 3 + 1] = blended.g;
		colors[index * 3 + 2] = blended.b;
	}
	position.needsUpdate = true;
	uv.needsUpdate = true;
	geometry.setAttribute('uv1', new THREE.BufferAttribute(microUvs, 2));
	geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
	geometry.computeVertexNormals();
	geometry.computeBoundingBox();
	geometry.computeBoundingSphere();
	const terrainAlbedo = getSharedTerrainAlbedoTexture();
	const material = new THREE.MeshStandardMaterial({
		vertexColors: true,
		map: terrainAlbedo,
		roughness: TERRAIN_MICRO_SURFACE_POLICY.roughnessBase,
		metalness: 0,
	});
	applyTerrainMicroSurface(material);
	const mesh = new THREE.Mesh(geometry, material);
	mesh.receiveShadow = true;
	mesh.position.set(chunkX * size, 0, chunkZ * size);
	mesh.userData.chunkCoord = { x: chunkX, z: chunkZ };
	mesh.userData.areaKm2 = (size * size) / 1_000_000;
	mesh.userData.currentTerrainPolicy = CURRENT_TERRAIN_POLICY.id;
	mesh.userData.currentTerrainSingleSource = true;
	mesh.userData.currentTerrainAlbedo = Object.freeze({
		policyId: CURRENT_TERRAIN_ALBEDO_POLICY.id,
		assetPath: CURRENT_TERRAIN_ALBEDO_POLICY.assetPath,
		mapAlignedUv: true,
		textureEnabled: Boolean(terrainAlbedo),
		mobileFallback: isCoarsePointerDevice(),
	});
	mesh.userData.currentTerrainMicroSurface = material.userData.terrainMicroSurface;
	return mesh;
}

export function disposeTerrainChunk(chunkMesh) {
	chunkMesh.geometry.dispose();
	// The albedo and micro normal/roughness textures are app-lifetime shared resources. Disposing a
	// single chunk must never invalidate texture maps still referenced by neighboring chunk materials.
	chunkMesh.material.dispose();
}
