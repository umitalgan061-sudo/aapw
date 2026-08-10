import assert from 'node:assert/strict';
import {
  EDITOR_WORLD_PATCH_POLICY,
  compileEditorWorldPatch,
  editorWorldPatchStats
} from '../src/3d/editor/EditorWorldPatchCompiler.js';

const transform = (x, y, z, scale = [1, 1, 1]) => ({ position: [x, y, z], rotation: [0, 0, 0], scale });
const scene = {
  schemaVersion: 1,
  world: { coordinateSystem: 'threejs-y-up', units: 'meters' },
  objects: [
    { id: 'water-2', name: 'Sea', asset: 'editor-water-cell', transform: transform(20, 0, 0, [10, 1, 10]) },
    { id: 'castle-2', name: 'Castle', asset: 'castle_emerald_citadel_decimated', transform: transform(5, 0, 4) },
    { id: 'road-2', name: 'Road', asset: 'editor-road-segment', transform: transform(0, 0, 0, [20, 1, 1]) },
    { id: 'land-2', name: 'Land', asset: 'editor-land-cell', transform: transform(10, 0, 0, [10, 1, 10]) },
    { id: 'prop-2', name: 'Wolf', asset: 'wolf', transform: transform(1, 0, 2) }
  ],
  instanceGroups: [{ id: 'formation-1', asset: 'marker-soldier', instances: [] }]
};

const patch = compileEditorWorldPatch(scene);
assert.equal(EDITOR_WORLD_PATCH_POLICY.patchVersion, 1);
assert.equal(patch.patchVersion, 1);
assert.equal(patch.sourceSchemaVersion, 1);
assert.equal(patch.coordinateSystem, 'threejs-y-up');
assert.equal(patch.units, 'meters');
assert.deepEqual(patch.buildings.map((item) => item.id), ['castle-2']);
assert.deepEqual(patch.roads.map((item) => item.id), ['road-2']);
assert.deepEqual(patch.landCells.map((item) => item.id), ['land-2']);
assert.deepEqual(patch.waterCells.map((item) => item.id), ['water-2']);
assert.deepEqual(patch.objects.map((item) => item.id), ['prop-2']);
assert.deepEqual(editorWorldPatchStats(patch), {
  buildings: 1,
  roads: 1,
  landCells: 1,
  waterCells: 1,
  objects: 1,
  instanceGroups: 1
});

scene.objects[0].transform.position[0] = 999;
scene.instanceGroups[0].asset = 'mutated';
assert.deepEqual([...patch.waterCells[0].position], [20, 0, 0], 'compiled transform must not alias source arrays');
assert.equal(patch.instanceGroups[0].asset, 'marker-soldier', 'compiled instance group must not alias source object');

const shuffled = { ...scene, objects: [...scene.objects].reverse(), instanceGroups: [] };
const shuffledPatch = compileEditorWorldPatch(shuffled);
assert.deepEqual(
  [...shuffledPatch.buildings, ...shuffledPatch.roads, ...shuffledPatch.landCells, ...shuffledPatch.waterCells, ...shuffledPatch.objects].map((item) => item.id).sort(),
  ['castle-2', 'land-2', 'prop-2', 'road-2', 'water-2'],
  'classification must remain stable after source reordering'
);

assert.throws(() => compileEditorWorldPatch({ schemaVersion: 2, objects: [], instanceGroups: [] }), /Unsupported/);
assert.throws(() => compileEditorWorldPatch({ schemaVersion: 1, objects: [], instanceGroups: null }), /instanceGroups/);
assert.throws(() => compileEditorWorldPatch({
  schemaVersion: 1,
  objects: [
    { id: 'same', asset: 'wolf', transform: transform(0, 0, 0) },
    { id: 'same', asset: 'paladin', transform: transform(0, 0, 0) }
  ],
  instanceGroups: []
}), /Duplicate editor object id/);
assert.throws(() => compileEditorWorldPatch({
  schemaVersion: 1,
  objects: [{ id: 'broken', asset: 'wolf', transform: { position: [0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] } }],
  instanceGroups: []
}), /finite \[x,y,z\]/);

console.log('PASS Run216 editor world patch compiler: deterministic typed classification, transform validation, duplicate-ID rejection, source isolation and stats.');
