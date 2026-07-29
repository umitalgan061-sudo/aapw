/**
 * Wraps Three.js loading primitives behind a single, fault-tolerant API.
 *
 * Every load method degrades gracefully: a missing or corrupt file never throws past this
 * module — it logs, emits an `asset:error` event, and (for models) returns a visible placeholder
 * mesh so the world still renders instead of crashing.
 * @module assetLoader
 */

import * as THREE from 'three';
import { gameEvents } from './eventBus.js';
import { EVENTS } from './config.js';

/** Relative path used for the lazy/dynamic import of GLTFLoader — only paid for once actually needed. */
const GLTF_LOADER_MODULE_PATH = './vendor/three/addons/loaders/GLTFLoader.js';

/** Relative path used for the lazy/dynamic import of FBXLoader — only paid for once a Mixamo-style
 * character/animation FBX is first requested (FAZ 4). */
const FBX_LOADER_MODULE_PATH = './vendor/three/addons/loaders/FBXLoader.js';

export class AssetLoader {
	/**
	 * @param {object} [options]
	 * @param {import('./eventBus.js').EventBus} [options.events] Bus to broadcast progress/errors on.
	 */
	constructor({ events = gameEvents } = {}) {
		this.events = events;
		this.manager = new THREE.LoadingManager();
		this.textureLoader = new THREE.TextureLoader(this.manager);
		/** @type {Promise<import('./vendor/three/addons/loaders/GLTFLoader.js').GLTFLoader>|null} */
		this._gltfLoaderPromise = null;
		/** @type {Promise<import('./vendor/three/addons/loaders/FBXLoader.js').FBXLoader>|null} */
		this._fbxLoaderPromise = null;

		this.manager.onProgress = (url, loaded, total) => {
			this.events.emit(EVENTS.ASSET_PROGRESS, { url, loaded, total, ratio: total > 0 ? loaded / total : 1 });
		};
		this.manager.onLoad = () => {
			this.events.emit(EVENTS.ASSETS_READY);
		};
		this.manager.onError = (url) => {
			this.events.emit(EVENTS.ASSET_ERROR, { url });
			console.warn(`[AssetLoader] failed to load "${url}"`);
		};
	}

	/** Lazily imports and constructs the GLTFLoader so it's never bundled/parsed until a model is requested. */
	async _getGLTFLoader() {
		if (!this._gltfLoaderPromise) {
			this._gltfLoaderPromise = import(GLTF_LOADER_MODULE_PATH).then(
				({ GLTFLoader }) => new GLTFLoader(this.manager)
			);
		}
		return this._gltfLoaderPromise;
	}

	/** Lazily imports and constructs the FBXLoader so it's never bundled/parsed until a character/animation FBX is requested. */
	async _getFBXLoader() {
		if (!this._fbxLoaderPromise) {
			this._fbxLoaderPromise = import(FBX_LOADER_MODULE_PATH).then(
				({ FBXLoader }) => new FBXLoader(this.manager)
			);
		}
		return this._fbxLoaderPromise;
	}

	/**
	 * Load an FBX file (Mixamo character mesh or skin-less animation clip). Returns the loaded
	 * `Group` as-is: for a character mesh, traverse it for the skinned mesh/skeleton; for an
	 * animation-only file, read `.animations[0]`. Falls back to a placeholder box on failure so a
	 * missing/corrupt character asset degrades the same way a missing GLTF model does.
	 * @param {string} url
	 * @param {object} [options]
	 * @param {number} [options.fallbackColor]
	 * @param {number} [options.fallbackSize]
	 * @returns {Promise<THREE.Group>}
	 */
	async loadFBXModel(url, { fallbackColor = 0xff00ff, fallbackSize = 1 } = {}) {
		try {
			const loader = await this._getFBXLoader();
			const object3D = await loader.loadAsync(url);
			this.events.emit(EVENTS.ASSET_LOADED, { url, type: 'fbx' });
			return object3D;
		} catch (error) {
			console.error(`[AssetLoader] loadFBXModel("${url}") failed, using placeholder box.`, error);
			this.events.emit(EVENTS.ASSET_ERROR, { url, type: 'fbx', error });
			return this._createPlaceholder(fallbackColor, fallbackSize);
		}
	}

	/**
	 * Load a GLTF/GLB model. Falls back to a simple colored box if the file is missing or invalid.
	 * @param {string} url
	 * @param {object} [options]
	 * @param {number} [options.fallbackColor]
	 * @param {number} [options.fallbackSize]
	 * @returns {Promise<THREE.Object3D>}
	 */
	async loadModel(url, { fallbackColor = 0xff00ff, fallbackSize = 1 } = {}) {
		try {
			const loader = await this._getGLTFLoader();
			const gltf = await loader.loadAsync(url);
			this.events.emit(EVENTS.ASSET_LOADED, { url, type: 'model' });
			return gltf.scene;
		} catch (error) {
			console.error(`[AssetLoader] loadModel("${url}") failed, using placeholder box.`, error);
			this.events.emit(EVENTS.ASSET_ERROR, { url, type: 'model', error });
			return this._createPlaceholder(fallbackColor, fallbackSize);
		}
	}

	/**
	 * Load a texture. Returns null on failure so callers can decide their own fallback material.
	 * @param {string} url
	 * @returns {Promise<THREE.Texture|null>}
	 */
	async loadTexture(url) {
		try {
			const texture = await this.textureLoader.loadAsync(url);
			this.events.emit(EVENTS.ASSET_LOADED, { url, type: 'texture' });
			return texture;
		} catch (error) {
			console.error(`[AssetLoader] loadTexture("${url}") failed.`, error);
			this.events.emit(EVENTS.ASSET_ERROR, { url, type: 'texture', error });
			return null;
		}
	}

	/** @private */
	_createPlaceholder(color, size) {
		const geometry = new THREE.BoxGeometry(size, size, size);
		const material = new THREE.MeshStandardMaterial({ color });
		const mesh = new THREE.Mesh(geometry, material);
		mesh.userData.isPlaceholder = true;
		return mesh;
	}

	/**
	 * Recursively disposes geometry/material/texture resources of an Object3D graph.
	 * Call this for anything removed from the scene to avoid GPU memory leaks.
	 * @param {THREE.Object3D} object
	 */
	static disposeObject3D(object) {
		if (!object) return;
		object.traverse((node) => {
			if (node.geometry) node.geometry.dispose();
			if (node.material) {
				const materials = Array.isArray(node.material) ? node.material : [node.material];
				for (const material of materials) {
					for (const key of Object.keys(material)) {
						const value = material[key];
						if (value && typeof value.dispose === 'function') value.dispose();
					}
					material.dispose();
				}
			}
		});
	}
}
