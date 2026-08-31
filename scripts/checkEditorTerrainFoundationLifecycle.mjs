#!/usr/bin/env node
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const worldEditor = readFileSync(new URL('../src/3d/editor/worldEditor.js', import.meta.url), 'utf8');
const placementController = readFileSync(new URL('../src/3d/editor/EditorPlacementController.js', import.meta.url), 'utf8');
const transformControls = readFileSync(new URL('../src/3d/editor/EditorTransformControls.js', import.meta.url), 'utf8');
const scaleInputController = readFileSync(new URL('../src/3d/editor/EditorScaleInputController.js', import.meta.url), 'utf8');

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
  /const surface = Object\.freeze\(\{[\s\S]*?groundObject,[\s\S]*?reconcileExistingStructureFoundations,[\s\S]*?removeObjectFoundation,[\s\S]*?removeObjectFoundations,/,
  'live placement API must expose foundation refresh, bootstrap reconciliation, plus single and batch removal operations',
);
expect(
  placementController,
  /function reconcileExistingStructureFoundations\(\)[\s\S]*?for \(const object of api\.editableObjects\)[\s\S]*?terrainGrounder\.isStructureObject\(object, asset\)[\s\S]*?editorFoundationKey[\s\S]*?terrainFoundationKey[\s\S]*?groundObject\(object, \{ asset \}\)/,
  'placement boot must reconcile library-backed and imported structure objects created before live terrain placement became available',
);
expect(
  placementController,
  /window\.__WESTEROS_EDITOR_PLACEMENT__ = surface;[\s\S]*?reconcileExistingStructureFoundations\(\)[\s\S]*?syncUi\(\)/,
  'placement installation must run existing-structure reconciliation after publishing the live placement surface',
);
expect(
  placementController,
  /function removeObjectFoundations\(objects, options = \{\}\)[\s\S]*?terrainGrounder\.removeObjectFoundations\(objects, options\)/,
  'placement controller batch cleanup must delegate options to the shared terrain grounder authority',
);
expect(
  placementController,
  /function dispose\(\)[\s\S]*?removeObjectFoundations\(api\.editableObjects, \{ rebuild: false \}\)[\s\S]*?disposed = true/,
  'placement teardown must retire live structure foundations without rebuilding terrain that will no longer render',
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

const addAssetBody = functionBody(worldEditor, 'addAsset', 'renderAssets');
expect(
  addAssetBody,
  /groundStructure = true[\s\S]*?scene\.add\(object\)[\s\S]*?isEditorStructureAsset\(asset\)[\s\S]*?regroundObjectFoundation\(object, asset\)/,
  'asset-library additions must automatically install a footprint terrain foundation for structure assets',
);
expect(
  addAssetBody,
  /grounding\.error !== 'live-placement-unavailable'/,
  'pre-controller asset creation may defer structure grounding so placement bootstrap can reconcile it later',
);
expect(
  worldEditor,
  /button\.addEventListener\('dblclick', \(\) => addAsset\(asset, controls\.target\.clone\(\)\)\)/,
  'asset-library double-click additions must use the automatically grounded addAsset path',
);
expect(
  worldEditor,
  /function applyInspector\([\s\S]*?hadFoundation[\s\S]*?regroundObjectFoundation\(selectedObject\)/,
  'inspector position/rotation transforms of foundation-owned structures must refresh terrain',
);
expect(
  scaleInputController,
  /function onScaleChange\(event\)[\s\S]*?object\.scale\[axis\] = next;[\s\S]*?refreshTerrainFoundation\(object\)/,
  'precise numeric Inspector scale changes must refresh the footprint foundation after committing the new scale',
);
expect(
  scaleInputController,
  /function refreshTerrainFoundation\(object\)[\s\S]*?editorFoundationKey[\s\S]*?terrainFoundationKey[\s\S]*?__WESTEROS_EDITOR_PLACEMENT__[\s\S]*?groundObject\(object\)/,
  'numeric scale foundation refresh must route through the live shared placement/terrain authority',
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
  /addAsset\(asset, new THREE\.Vector3\(\.\.\.record\.transform\.position\), \{ groundStructure: false \}\)[\s\S]*?object\.rotation\.set[\s\S]*?object\.scale\.set[\s\S]*?isEditorStructureAsset\(asset\)[\s\S]*?regroundObjectFoundation\(object, asset\)/,
  'scene replacement must defer addAsset grounding until persisted rotation and scale are restored, then create one correct foundation',
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

console.log('[checkEditorTerrainFoundationLifecycle] PASS: editor structure foundations auto-ground on asset creation, reconcile library/imported pre-controller structures, track Inspector position/rotation/numeric-scale plus drag-end/quick-scale/clone/delete lifecycles, batch-retire scene replacements, and teardown shared pads without useless terrain rebuilds.');
