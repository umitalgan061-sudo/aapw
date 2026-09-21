/** Production TypeScript asset-loading boundary with graceful placeholders and deterministic cleanup. */
import * as THREE from 'three';
import { gameEvents, type EventBus } from './eventBus.ts';
import { EVENTS } from './config.ts';

const GLTF_LOADER_MODULE_PATH = './vendor/three/addons/loaders/GLTFLoader.js';
const FBX_LOADER_MODULE_PATH = './vendor/three/addons/loaders/FBXLoader.js';

interface LoadProgressPayload {
  readonly url: string;
  readonly loaded: number;
  readonly total: number;
  readonly ratio: number;
}

interface AssetEventPayload {
  readonly url: string;
  readonly type: 'fbx' | 'model' | 'texture';
  readonly error?: unknown;
}

interface GLTFAsset {
  readonly scene: THREE.Object3D;
  readonly animations: readonly THREE.AnimationClip[];
}

interface GLTFLoaderLike {
  loadAsync(url: string): Promise<GLTFAsset>;
}

interface FBXLoaderLike {
  setResourcePath(path: string): void;
  loadAsync(url: string): Promise<THREE.Group>;
}

interface GLTFLoaderModule {
  readonly GLTFLoader: new (manager?: THREE.LoadingManager) => GLTFLoaderLike;
}

interface FBXLoaderModule {
  readonly FBXLoader: new (manager?: THREE.LoadingManager) => FBXLoaderLike;
}

export interface AnimatedObject3D extends THREE.Object3D {
  animations: readonly THREE.AnimationClip[];
}

export interface AssetLoadOptions {
  readonly fallbackColor?: THREE.ColorRepresentation;
  readonly fallbackSize?: number;
  readonly resourcePath?: string;
}

export interface AssetLoaderOptions {
  readonly events?: EventBus;
}

export class AssetLoader {
  readonly events: EventBus;
  readonly manager: THREE.LoadingManager;
  readonly textureLoader: THREE.TextureLoader;
  #gltfLoaderPromise: Promise<GLTFLoaderLike> | null = null;
  #fbxLoaderPromise: Promise<FBXLoaderLike> | null = null;

  constructor({ events = gameEvents }: AssetLoaderOptions = {}) {
    this.events = events;
    this.manager = new THREE.LoadingManager();
    this.textureLoader = new THREE.TextureLoader(this.manager);

    this.manager.onProgress = (url: string, loaded: number, total: number): void => {
      const payload: LoadProgressPayload = {
        url,
        loaded,
        total,
        ratio: total > 0 ? loaded / total : 1,
      };
      this.events.emit(EVENTS.ASSET_PROGRESS, payload);
    };
    this.manager.onLoad = (): void => {
      this.events.emit(EVENTS.ASSETS_READY, undefined);
    };
    this.manager.onError = (url: string): void => {
      const payload: AssetEventPayload = { url, type: 'model' };
      this.events.emit(EVENTS.ASSET_ERROR, payload);
      console.warn(`[AssetLoader] failed to load "${url}"`);
    };
  }

  async #getGLTFLoader(): Promise<GLTFLoaderLike> {
    if (!this.#gltfLoaderPromise) {
      this.#gltfLoaderPromise = import(GLTF_LOADER_MODULE_PATH).then(
        (module) => new (module as unknown as GLTFLoaderModule).GLTFLoader(this.manager),
      );
    }
    return this.#gltfLoaderPromise;
  }

  async #getFBXLoader(): Promise<FBXLoaderLike> {
    if (!this.#fbxLoaderPromise) {
      this.#fbxLoaderPromise = import(FBX_LOADER_MODULE_PATH).then(
        (module) => new (module as unknown as FBXLoaderModule).FBXLoader(this.manager),
      );
    }
    return this.#fbxLoaderPromise;
  }

  async loadFBXModel(
    url: string,
    { fallbackColor = 0xff00ff, fallbackSize = 1, resourcePath }: AssetLoadOptions = {},
  ): Promise<THREE.Object3D> {
    try {
      const loader = await this.#getFBXLoader();
      loader.setResourcePath(resourcePath ?? '');
      const object3D = await loader.loadAsync(url);
      this.events.emit(EVENTS.ASSET_LOADED, { url, type: 'fbx' } satisfies AssetEventPayload);
      return object3D;
    } catch (error) {
      console.error(`[AssetLoader] loadFBXModel("${url}") failed, using placeholder box.`, error);
      this.events.emit(EVENTS.ASSET_ERROR, { url, type: 'fbx', error } satisfies AssetEventPayload);
      return this.#createPlaceholder(fallbackColor, fallbackSize);
    }
  }

  async loadModel(
    url: string,
    { fallbackColor = 0xff00ff, fallbackSize = 1 }: AssetLoadOptions = {},
  ): Promise<AnimatedObject3D> {
    try {
      const loader = await this.#getGLTFLoader();
      const gltf = await loader.loadAsync(url);
      this.events.emit(EVENTS.ASSET_LOADED, { url, type: 'model' } satisfies AssetEventPayload);
      const scene = gltf.scene as AnimatedObject3D;
      scene.animations = gltf.animations;
      return scene;
    } catch (error) {
      console.error(`[AssetLoader] loadModel("${url}") failed, using placeholder box.`, error);
      this.events.emit(EVENTS.ASSET_ERROR, { url, type: 'model', error } satisfies AssetEventPayload);
      return this.#createPlaceholder(fallbackColor, fallbackSize);
    }
  }

  async loadTexture(url: string): Promise<THREE.Texture | null> {
    try {
      const texture = await this.textureLoader.loadAsync(url);
      this.events.emit(EVENTS.ASSET_LOADED, { url, type: 'texture' } satisfies AssetEventPayload);
      return texture;
    } catch (error) {
      console.error(`[AssetLoader] loadTexture("${url}") failed.`, error);
      this.events.emit(EVENTS.ASSET_ERROR, { url, type: 'texture', error } satisfies AssetEventPayload);
      return null;
    }
  }

  static correctMixamoFbxScale(model: THREE.Object3D): void {
    const unitScaleFactor = Number(model.userData.unitScaleFactor) || 1;
    const metersPerFbxUnit = unitScaleFactor / 100;
    if (Math.abs(metersPerFbxUnit - 1) > 1e-6) model.scale.setScalar(metersPerFbxUnit);
  }

  #createPlaceholder(color: THREE.ColorRepresentation, size: number): AnimatedObject3D {
    const safeSize = Number.isFinite(size) ? Math.max(0.01, size) : 1;
    const geometry = new THREE.BoxGeometry(safeSize, safeSize, safeSize);
    const material = new THREE.MeshStandardMaterial({ color });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.userData.isPlaceholder = true;
    const placeholder = mesh as AnimatedObject3D;
    placeholder.animations = [];
    return placeholder;
  }

  static disposeObject3D(object: THREE.Object3D | null | undefined): void {
    if (!object) return;
    object.traverse((node) => {
      if (node instanceof THREE.Mesh) {
        node.geometry?.dispose();
        const materials = Array.isArray(node.material) ? node.material : [node.material];
        for (const material of materials) {
          for (const value of Object.values(material as unknown as Record<string, unknown>)) {
            if (value && typeof value === 'object' && 'dispose' in value && typeof (value as { dispose?: unknown }).dispose === 'function') {
              (value as { dispose: () => void }).dispose();
            }
          }
          material.dispose();
        }
      }
    });
  }
}
