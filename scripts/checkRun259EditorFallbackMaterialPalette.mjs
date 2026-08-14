import assert from 'node:assert/strict';
import { applyEditorFallbackMaterialPalette, EDITOR_FALLBACK_MATERIAL_PALETTE } from '../src/3d/editor/EditorFallbackMaterialPalette.js';

function color(r, g, b) {
  return {
    r, g, b,
    hex: null,
    setHex(value) { this.hex = value; }
  };
}

function material({ r = 0.8, g = 0.8, b = 0.8, map = null, vertexColors = false } = {}) {
  return {
    color: color(r, g, b),
    map,
    vertexColors,
    clone() {
      return material({ r: this.color.r, g: this.color.g, b: this.color.b, map: this.map, vertexColors: this.vertexColors });
    }
  };
}

function rootWith(meshes) {
  return { traverse(callback) { for (const mesh of meshes) callback(mesh); } };
}

const grayMesh = { isMesh: true, name: 'Body', material: material(), userData: {} };
const texturedMesh = { isMesh: true, name: 'Cape', material: material({ map: {} }), userData: {} };
const coloredMesh = { isMesh: true, name: 'Banner', material: material({ r: 0.9, g: 0.2, b: 0.1 }), userData: {} };
const asset = { id: 'test-fbx', format: 'fbx' };

const first = applyEditorFallbackMaterialPalette(rootWith([grayMesh, texturedMesh, coloredMesh]), asset);
assert.equal(first.tintedMeshes, 1);
assert.equal(grayMesh.userData.editorFallbackPalette, true);
assert.ok(EDITOR_FALLBACK_MATERIAL_PALETTE.colors.includes(grayMesh.material.color.hex));
assert.equal(texturedMesh.material.color.hex, null);
assert.equal(coloredMesh.material.color.hex, null);

const repeatMesh = { isMesh: true, name: 'Body', material: material(), userData: {} };
applyEditorFallbackMaterialPalette(rootWith([repeatMesh]), asset);
assert.equal(repeatMesh.material.color.hex, grayMesh.material.color.hex, 'same FBX mesh must receive deterministic color');

const primitiveMesh = { isMesh: true, name: 'Body', material: material(), userData: {} };
assert.equal(applyEditorFallbackMaterialPalette(rootWith([primitiveMesh]), { id: 'primitive', format: 'primitive' }).tintedMeshes, 0);
assert.equal(primitiveMesh.material.color.hex, null);

console.log('Run259 Editor fallback material palette PASS');
