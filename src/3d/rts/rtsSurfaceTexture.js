import * as THREE from 'three';
import { WORLD_SCALE } from '../config.js';
import { ChunkManager } from '../world/chunkManager.js';

const SOURCE_URL = 'assets/textures/yüzey/overlay/overlay.png';
const DESKTOP_TEXTURE_SIZE = 1024;
const MOBILE_TEXTURE_SIZE = 512;
const DETAIL_OPACITY = 0.24;
const DETAIL_FILTER = 'blur(1.2px) saturate(0.52) contrast(0.86)';

let installed = false;
let disposed = false;
let runtimeTexture = null;
const managers = new Set();

const state = {
	status: 'idle',
	sourceUrl: SOURCE_URL,
	sourceWidth: 0,
	sourceHeight: 0,
	runtimeTextureSize: 0,
	detailOpacity: DETAIL_OPACITY,
	appliedChunks: 0,
	uvMode: 'world-space-clamped',
};

function isCoarsePointer() {
	return typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia('(pointer: coarse)').matches;
}

function clamp01(value) {
	return Math.max(0, Math.min(1, value));
}

function ensureWorldUv(mesh) {
	if (!mesh?.geometry || mesh.userData.rtsSurfaceWorldUvRun210 === true) return;
	const position = mesh.geometry.getAttribute('position');
	if (!position) return;
	let uv = mesh.geometry.getAttribute('uv');
	if (!uv || uv.count !== position.count) {
		uv = new THREE.BufferAttribute(new Float32Array(position.count * 2), 2);
		mesh.geometry.setAttribute('uv', uv);
	}
	const halfWidth = WORLD_SCALE.WORLD_WIDTH_METERS / 2;
	const halfDepth = WORLD_SCALE.WORLD_DEPTH_METERS / 2;
	for (let index = 0; index < position.count; index += 1) {
		const worldX = mesh.position.x + position.getX(index);
		const worldZ = mesh.position.z + position.getZ(index);
		const u = clamp01((worldX + halfWidth) / WORLD_SCALE.WORLD_WIDTH_METERS);
		const v = clamp01(1 - ((worldZ + halfDepth) / WORLD_SCALE.WORLD_DEPTH_METERS));
		uv.setXY(index, u, v);
	}
	uv.needsUpdate = true;
	mesh.userData.rtsSurfaceWorldUvRun210 = true;
}

function setTextureOnMaterial(material) {
	if (!material || !runtimeTexture) return;
	material.map = runtimeTexture;
	material.vertexColors = true;
	material.needsUpdate = true;
}

function applyToTerrainMesh(mesh) {
	if (!mesh?.geometry) return;
	ensureWorldUv(mesh);
	if (!runtimeTexture) return;
	if (Array.isArray(mesh.material)) {
		for (const material of mesh.material) setTextureOnMaterial(material);
	} else {
		setTextureOnMaterial(mesh.material);
	}
	if (mesh.userData.rtsSurfaceTextureAppliedRun210 !== true) {
		mesh.userData.rtsSurfaceTextureAppliedRun210 = true;
		state.appliedChunks += 1;
	}
}

function applyToManager(manager) {
	if (!manager?.loaded) return;
	for (const mesh of manager.loaded.values()) applyToTerrainMesh(mesh);
}

function createRuntimeTexture(image) {
	const textureSize = isCoarsePointer() ? MOBILE_TEXTURE_SIZE : DESKTOP_TEXTURE_SIZE;
	const canvas = document.createElement('canvas');
	canvas.width = textureSize;
	canvas.height = textureSize;
	const context = canvas.getContext('2d', { alpha: false });
	if (!context) throw new Error('2D canvas context unavailable');
	context.fillStyle = '#ffffff';
	context.fillRect(0, 0, textureSize, textureSize);
	context.save();
	context.globalAlpha = DETAIL_OPACITY;
	context.filter = DETAIL_FILTER;
	context.imageSmoothingEnabled = true;
	context.imageSmoothingQuality = 'high';
	context.drawImage(image, 0, 0, textureSize, textureSize);
	context.restore();
	const texture = new THREE.CanvasTexture(canvas);
	texture.name = 'run210-owner-surface-detail';
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.wrapS = THREE.ClampToEdgeWrapping;
	texture.wrapT = THREE.ClampToEdgeWrapping;
	texture.minFilter = THREE.LinearMipmapLinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = true;
	state.runtimeTextureSize = textureSize;
	return texture;
}

function startTextureLoad() {
	state.status = 'loading';
	const image = new Image();
	image.decoding = 'async';
	image.addEventListener('load', () => {
		if (disposed) return;
		state.sourceWidth = image.naturalWidth;
		state.sourceHeight = image.naturalHeight;
		try {
			runtimeTexture = createRuntimeTexture(image);
			state.status = 'ready';
			for (const manager of managers) applyToManager(manager);
		} catch (_error) {
			state.status = 'failed';
		}
	}, { once: true });
	image.addEventListener('error', () => {
		if (!disposed) state.status = 'failed';
	}, { once: true });
	image.src = SOURCE_URL;
}

export function installRtsSurfaceTexture() {
	if (installed) return state;
	installed = true;
	if (typeof window === 'undefined' || typeof document === 'undefined') return state;
	window.__WESTEROS_RTS_SURFACE__ = state;
	const loadChunkBeforeRun210 = ChunkManager.prototype.loadChunk;
	const streamTowardsBeforeRun210 = ChunkManager.prototype.streamTowards;
	ChunkManager.prototype.loadChunk = function loadChunkWithRtsSurfaceRun210(chunkX, chunkZ) {
		managers.add(this);
		const mesh = loadChunkBeforeRun210.call(this, chunkX, chunkZ);
		applyToTerrainMesh(mesh);
		return mesh;
	};
	ChunkManager.prototype.streamTowards = function streamTowardsWithRtsSurfaceRun210(centerChunkX, centerChunkZ, radius) {
		managers.add(this);
		const result = streamTowardsBeforeRun210.call(this, centerChunkX, centerChunkZ, radius);
		applyToManager(this);
		return result;
	};
	startTextureLoad();
	window.addEventListener('pagehide', () => {
		disposed = true;
		state.status = 'disposed';
		runtimeTexture?.dispose();
		runtimeTexture = null;
		managers.clear();
		if (ChunkManager.prototype.loadChunk !== loadChunkBeforeRun210) ChunkManager.prototype.loadChunk = loadChunkBeforeRun210;
		if (ChunkManager.prototype.streamTowards !== streamTowardsBeforeRun210) ChunkManager.prototype.streamTowards = streamTowardsBeforeRun210;
	}, { once: true });
	return state;
}
