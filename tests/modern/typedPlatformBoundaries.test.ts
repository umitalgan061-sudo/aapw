import { describe, expect, it, vi } from 'vitest';
import * as THREE from 'three';
import { resolveCameraCollision } from '../../src/3d/camera.ts';
import { AssetLoader } from '../../src/3d/assetLoader.ts';

describe('typed camera boundary', () => {
  it('keeps the desired camera position when nothing occludes the target', () => {
    const raycaster = new THREE.Raycaster();
    const target = new THREE.Vector3(0, 1, 0);
    const desired = new THREE.Vector3(0, 2, 10);
    expect(resolveCameraCollision(raycaster, target, desired, [], 0.2, 1)).toBe(desired);
  });
});

describe('typed asset boundary', () => {
  it('converts Mixamo FBX units without disturbing metre-authored models', () => {
    const model = new THREE.Group();
    model.userData.unitScaleFactor = 1;
    AssetLoader.correctMixamoFbxScale(model);
    expect(model.scale.x).toBeCloseTo(0.01);

    const metreModel = new THREE.Group();
    metreModel.userData.unitScaleFactor = 100;
    AssetLoader.correctMixamoFbxScale(metreModel);
    expect(metreModel.scale.x).toBeCloseTo(1);
  });

  it('disposes geometry and material-owned textures', () => {
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const texture = new THREE.Texture();
    const material = new THREE.MeshStandardMaterial({ map: texture });
    const mesh = new THREE.Mesh(geometry, material);
    const group = new THREE.Group();
    group.add(mesh);
    const geometryDispose = vi.spyOn(geometry, 'dispose');
    const textureDispose = vi.spyOn(texture, 'dispose');
    AssetLoader.disposeObject3D(group);
    expect(geometryDispose).toHaveBeenCalledOnce();
    expect(textureDispose).toHaveBeenCalledOnce();
  });
});
