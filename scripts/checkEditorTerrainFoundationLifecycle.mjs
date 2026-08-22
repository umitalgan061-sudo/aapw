#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worldEditor = readFileSync(new URL('../src/3d/editor/worldEditor.js', import.meta.url), 'utf8');
const placementController = readFileSync(new URL('../src/3d/editor/EditorPlacementController.js', import.meta.url), 'utf8');
const transformControls = readFileSync(new URL('../src/3d/editor/EditorTransformControls.js', import.meta.url), 'utf8');

function expect(source, pattern, message) {
  assert(pattern.test(source), message);
}

function functionBody(source, name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `${name} must exist`);
  const end = nextName ? source.indexOf(`function ${nextName}(`, start) : source.length;
  assert.notEqual(end, -1, `${nextName} must follow ${name}`);
  return source.slice(start, end);
}

expect(
  placementController,
  /const surface = Object\.freeze\(\{[\s\S]*?groundObject,[\s\S]*?removeObjectFoundation,[\s\S]*?removeObjectFoundations,/,
  'live placement API must expose foundation refresh plus single and batch removal operations',
);
expect(
  placementController,
  /function removeObjectFoundations\(objects\)[\s\S]*?terrainGrounder\.removeObjectFoundations\(objects\)/,
  'placement controller batch cleanup must delegate to the shared terrain grounder authority',
);
expect(
  worldEditor,
  /function retireObjectFoundation\([\s\S]*?removeObjectFoundation\(object\)/,
  'single object deletion must retire its live terrain foundation',
);
expect(
  worldEditor,
  /function retireObjectFoundations\([\s\S]*?removeObjectFoundations\(candidates\)/,
  'scene replacement must expose a batch foundation retirement path',
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
  'single structure deletion must remove its terrain pad before removing the scene object',
);

const loadSceneBody = functionBody(worldEditor, 'loadSceneFile', null);
expect(
  loadSceneBody,
  /const previousObjects = \[\.\.\.editableObjects\];[\s\S]*?retireObjectFoundations\(previousObjects\)[\s\S]*?for \(const object of previousObjects\)[\s\S]*?scene\.remove\(object\)[\s\S]*?editableObjects\.splice\(0, editableObjects\.length\)/,
  'scene replacement must retire all previous foundations in one batch before clearing scene objects',
);
assert.equal(
  /retireObjectFoundation\(object\)/.test(loadSceneBody),
  false,
  'scene replacement must not rebuild terrain once per previous object',
);
expect(
  loadSceneBody,
  /isEditorStructureAsset\(asset\)[\s\S]*?regroundObjectFoundation\(object, asset\)/,
  'scene replacement must recreate foundations for loaded structures after batch cleanup',
);

const objectChangeBody = functionBody(transformControls, 'onObjectChange', 'onDraggingChanged');
expect(
  objectChangeBody,
  /writeInspector[\s\S]*?refreshHierarchy/,
  'drag frames must keep inspector/hierarchy responsive',
);
assert.equal(
  /refreshTerrainFoundation\(/.test(objectChangeBody),
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

console.log('[checkEditorTerrainFoundationLifecycle] PASS: editor structure foundations track inspector, drag-end, quick-scale, clone and delete lifecycles while scene replacement batch-retires old foundations without per-object terrain rebuilds.');
