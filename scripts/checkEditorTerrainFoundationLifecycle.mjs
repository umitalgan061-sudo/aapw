#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worldEditor = readFileSync(new URL('../src/3d/editor/worldEditor.js', import.meta.url), 'utf8');
const placementController = readFileSync(new URL('../src/3d/editor/EditorPlacementController.js', import.meta.url), 'utf8');
const transformControls = readFileSync(new URL('../src/3d/editor/EditorTransformControls.js', import.meta.url), 'utf8');

function expect(source, pattern, message) {
  assert(pattern.test(source), message);
}

expect(
  placementController,
  /const surface = Object\.freeze\(\{[\s\S]*?groundObject,[\s\S]*?removeObjectFoundation,/,
  'live placement API must expose both foundation refresh and removal operations',
);
expect(
  worldEditor,
  /function retireObjectFoundation\([\s\S]*?removeObjectFoundation\(object\)/,
  'object deletion/reload cleanup must retire its live terrain foundation',
);
expect(
  worldEditor,
  /function applyInspector\([\s\S]*?hadFoundation[\s\S]*?regroundObjectFoundation\(selectedObject\)/,
  'inspector transforms of foundation-owned structures must refresh terrain',
);
expect(
  worldEditor,
  /function duplicateSelected\([\s\S]*?editorFoundationKey:[\s\S]*?terrainFoundationKey:[\s\S]*?regroundObjectFoundation\(clone/,
  'structure duplication must strip inherited foundation identity and install an independent foundation',
);
expect(
  worldEditor,
  /function deleteSelected\([\s\S]*?retireObjectFoundation\(selectedObject\)[\s\S]*?scene\.remove\(selectedObject\)/,
  'structure deletion must remove its terrain pad before removing the scene object',
);
expect(
  worldEditor,
  /async function loadSceneFile\([\s\S]*?retireObjectFoundation\(object\)[\s\S]*?isEditorStructureAsset\(asset\)[\s\S]*?regroundObjectFoundation\(object, asset\)/,
  'scene replacement must remove previous pads and recreate foundations for loaded structures',
);

expect(
  transformControls,
  /function onObjectChange\([\s\S]*?writeInspector[\s\S]*?refreshHierarchy[\s\S]*?\n  \}/,
  'drag frames must keep inspector/hierarchy responsive',
);
assert.equal(
  /function onObjectChange\([\s\S]*?refreshTerrainFoundation\(/.test(transformControls),
  false,
  'terrain chunks must not rebuild on every TransformControls pointer frame',
);
expect(
  transformControls,
  /function onDraggingChanged\(event\)[\s\S]*?if \(event\.value \|\| !transform\.object\) return;[\s\S]*?refreshTerrainFoundation\(transform\.object\)/,
  'drag end must refresh the structure foundation exactly after manipulation settles',
);
expect(
  transformControls,
  /OWNER_QUICK_SHRINK_FACTOR[\s\S]*?button\.addEventListener\('click'[\s\S]*?object\.scale\.set\([\s\S]*?refreshTerrainFoundation\(object\)/,
  'quick scale authoring must refresh a foundation-owned structure after scale changes',
);

console.log('[checkEditorTerrainFoundationLifecycle] PASS: editor structure foundations track inspector, drag-end, quick-scale, clone, delete and scene-load lifecycles without rebuilding terrain every pointer frame.');
