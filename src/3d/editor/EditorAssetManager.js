import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';

function createPrimitive(asset) {
  if (asset.primitive === 'tree') {
    const group = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2, 8), new THREE.MeshStandardMaterial({ color: 0x5d4025 }));
    const crown = new THREE.Mesh(new THREE.ConeGeometry(1.15, 3, 10), new THREE.MeshStandardMaterial({ color: 0x315c34 }));
    trunk.position.y = 1;
    crown.position.y = 3;
    group.add(trunk, crown);
    return group;
  }
  if (asset.primitive === 'soldier') {
    const group = new THREE.Group();
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.35, 1.1, 4, 8), new THREE.MeshStandardMaterial({ color: 0x6c788b }));
    body.position.y = 1.05;
    group.add(body);
    return group;
  }
  const group = new THREE.Group();
  const base = new THREE.Mesh(new THREE.BoxGeometry(3.5, 2.4, 3.5), new THREE.MeshStandardMaterial({ color: 0x6a6d73 }));
  const tower = new THREE.Mesh(new THREE.CylinderGeometry(1, 1.2, 4.6, 8), base.material);
  base.position.y = 1.2;
  tower.position.set(0, 2.3, 0);
  group.add(base, tower);
  return group;
}

export class EditorAssetManager {
  constructor() {
    this.cache = new Map();
    this.gltfLoader = new GLTFLoader();
    this.fbxLoader = new FBXLoader();
  }

  async loadTemplate(asset) {
    if (this.cache.has(asset.id)) return this.cache.get(asset.id);
    const promise = this.#load(asset);
    this.cache.set(asset.id, promise);
    try {
      return await promise;
    } catch (error) {
      this.cache.delete(asset.id);
      throw error;
    }
  }

  async #load(asset) {
    if (asset.format === 'primitive') return createPrimitive(asset);
    if (asset.format === 'glb' || asset.format === 'gltf') {
      const gltf = await this.gltfLoader.loadAsync(asset.src);
      return gltf.scene;
    }
    if (asset.format === 'fbx') {
      if (asset.resourcePath) this.fbxLoader.setResourcePath(asset.resourcePath);
      const root = await this.fbxLoader.loadAsync(asset.src);
      this.fbxLoader.setResourcePath('');
      return root;
    }
    throw new Error(`Desteklenmeyen asset formatı: ${asset.format}`);
  }

  async createObject(asset) {
    const template = await this.loadTemplate(asset);
    const object = template.clone(true);
    object.userData.editorAssetId = asset.id;
    object.userData.editorFormat = asset.format;
    object.name = asset.name;
    object.traverse((child) => {
      if (child.isMesh) {
        child.castShadow = true;
        child.receiveShadow = true;
        child.userData.editorRoot = object;
      }
    });
    return object;
  }
}
