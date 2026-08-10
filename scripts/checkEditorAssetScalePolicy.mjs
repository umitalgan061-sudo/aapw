import assert from 'node:assert/strict';
import { computeEditorAssetImportScale } from '../src/3d/editor/EditorAssetScalePolicy.js';

assert.equal(computeEditorAssetImportScale({ id: 'marker-soldier', format: 'primitive' }, 100), 1);
assert.equal(computeEditorAssetImportScale({ id: 'wolf', format: 'glb' }, 1.6), 1);
assert.equal(computeEditorAssetImportScale({ id: 'black-dragon', format: 'fbx' }, 200), 0.04);
assert.equal(computeEditorAssetImportScale({ id: 'paladin', format: 'fbx' }, 180), 2 / 180);
assert.equal(computeEditorAssetImportScale({ id: 'peasant-girl', format: 'fbx' }, 165), 1.8 / 165);
assert.equal(computeEditorAssetImportScale({ id: 'unknown-fbx', format: 'fbx' }, 100), 0.02);
assert.equal(computeEditorAssetImportScale({ id: 'broken', format: 'fbx' }, Number.NaN), 1);

console.log('Editor asset scale policy: PASS');
