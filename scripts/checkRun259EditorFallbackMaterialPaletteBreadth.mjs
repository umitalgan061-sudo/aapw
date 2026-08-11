import assert from 'node:assert/strict';
import { applyEditorFallbackMaterialPalette, EDITOR_FALLBACK_MATERIAL_PALETTE } from '../src/3d/editor/EditorFallbackMaterialPalette.js';

const colors = EDITOR_FALLBACK_MATERIAL_PALETTE.colors;
const uniqueColors = new Set(colors);

assert.ok(colors.length >= 120, `expected at least 120 fallback colors, got ${colors.length}`);
assert.equal(uniqueColors.size, colors.length, 'fallback palette colors must stay unique');
assert.ok(!uniqueColors.has(0xffffff), 'pure white must not be used as a fallback color');
assert.ok(!uniqueColors.has(0x000000), 'pure black must not be used as a fallback color');

function color(r = 0.78, g = 0.78, b = 0.78) {
  return {
    r,
    g,
    b,
    hex: null,
    setHex(value) { this.hex = value; }
  };
}

function material() {
  return {
    color: color(),
    map: null,
    vertexColors: false,
    clone() { return material(); }
  };
}

const meshes = Array.from({ length: 480 }, (_, index) => ({
  isMesh: true,
  name: `ColorlessMesh-${index}`,
  material: material(),
  userData: {}
}));
const root = { traverse(callback) { meshes.forEach(callback); } };
const asset = { id: 'palette-breadth-proof', format: 'fbx' };
const result = applyEditorFallbackMaterialPalette(root, asset);
const appliedColors = new Set(meshes.map((mesh) => mesh.material.color.hex));

assert.equal(result.tintedMeshes, meshes.length, 'every eligible colorless FBX mesh must receive a fallback color');
assert.ok(appliedColors.size >= 100, `expected broad deterministic coverage, got ${appliedColors.size} distinct applied colors`);
for (const applied of appliedColors) assert.ok(uniqueColors.has(applied), 'every applied color must come from the curated fallback palette');

const repeatMeshes = Array.from({ length: 480 }, (_, index) => ({
  isMesh: true,
  name: `ColorlessMesh-${index}`,
  material: material(),
  userData: {}
}));
applyEditorFallbackMaterialPalette({ traverse(callback) { repeatMeshes.forEach(callback); } }, asset);
assert.deepEqual(
  repeatMeshes.map((mesh) => mesh.material.color.hex),
  meshes.map((mesh) => mesh.material.color.hex),
  'expanded palette assignment must remain deterministic'
);

console.log(`Run259 Editor fallback palette breadth PASS (${colors.length} curated colors, ${appliedColors.size} observed)`);
