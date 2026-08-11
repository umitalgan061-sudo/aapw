import assert from 'node:assert/strict';
import { applyEditorFallbackMaterialPalette, EDITOR_FALLBACK_MATERIAL_PALETTE } from '../src/3d/editor/EditorFallbackMaterialPalette.js';

const policy = EDITOR_FALLBACK_MATERIAL_PALETTE;
const colors = policy.colors;
const uniqueColors = new Set(colors);

assert.ok(policy.familyCount >= 24, `expected at least 24 coordinated hue families, got ${policy.familyCount}`);
assert.ok(policy.tonesPerFamily >= 12, `expected at least 12 tones per family, got ${policy.tonesPerFamily}`);
assert.ok(colors.length >= 288, `expected at least 288 fallback colors, got ${colors.length}`);
assert.equal(uniqueColors.size, colors.length, 'fallback palette colors must stay unique');
assert.equal(policy.families.length, policy.familyCount, 'family metadata must match generated families');
for (const family of policy.families) assert.equal(family.length, policy.tonesPerFamily, 'every family must expose the full tone range');
assert.ok(!uniqueColors.has(0xffffff), 'pure white must not be used as a fallback color');
assert.ok(!uniqueColors.has(0x000000), 'pure black must not be used as a fallback color');

function color(r = 0.78, g = 0.78, b = 0.78) {
  return { r, g, b, hex: null, setHex(value) { this.hex = value; } };
}

function material() {
  return {
    color: color(),
    map: null,
    vertexColors: false,
    clone() { return material(); }
  };
}

function buildMeshes(count) {
  return Array.from({ length: count }, (_, index) => ({
    isMesh: true,
    name: `ColorlessMesh-${index}`,
    material: material(),
    userData: {}
  }));
}

const allAppliedColors = new Set();
for (let assetIndex = 0; assetIndex < 48; assetIndex += 1) {
  const meshes = buildMeshes(48);
  const root = { traverse(callback) { meshes.forEach(callback); } };
  const asset = { id: `palette-asset-${assetIndex}`, format: 'fbx' };
  const result = applyEditorFallbackMaterialPalette(root, asset);
  const applied = new Set(meshes.map((mesh) => mesh.material.color.hex));
  assert.equal(result.tintedMeshes, meshes.length, 'every eligible colorless FBX mesh must receive a fallback color');
  assert.ok(applied.size >= 10, `one model should receive a rich but coordinated tone range, got ${applied.size}`);
  assert.ok(applied.size <= policy.tonesPerFamily, 'one model must stay inside one coordinated hue family');
  for (const value of applied) {
    assert.ok(uniqueColors.has(value), 'every applied color must come from the generated fallback palette');
    allAppliedColors.add(value);
  }
}
assert.equal(allAppliedColors.size, colors.length, 'deterministic sample must exercise the complete 288-color palette');

const repeatMeshes = buildMeshes(48);
const repeatAsset = { id: 'palette-asset-17', format: 'fbx' };
applyEditorFallbackMaterialPalette({ traverse(callback) { repeatMeshes.forEach(callback); } }, repeatAsset);
const secondRepeat = buildMeshes(48);
applyEditorFallbackMaterialPalette({ traverse(callback) { secondRepeat.forEach(callback); } }, repeatAsset);
assert.deepEqual(
  secondRepeat.map((mesh) => mesh.material.color.hex),
  repeatMeshes.map((mesh) => mesh.material.color.hex),
  'expanded palette assignment must remain deterministic'
);

console.log(`Run259 Editor fallback palette breadth PASS (${colors.length} colors, ${policy.familyCount} families, ${policy.tonesPerFamily} tones/family)`);
