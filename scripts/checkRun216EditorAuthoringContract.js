'use strict';

const fs = require('fs');

const read = (path) => fs.readFileSync(path, 'utf8');
const html = read('editor.html');
const library = read('src/3d/editor/editorAssetLibrary.js');
const manager = read('src/3d/editor/EditorAssetManager.js');
const clipboard = read('src/3d/editor/EditorClipboardController.js');
const environment = read('src/3d/editor/EditorEditModeEnvironment.js');
const roads = read('src/3d/editor/EditorRoadController.js');
const terrain = read('src/3d/editor/EditorTerrainPaintController.js');
const serializer = read('src/3d/editor/EditorSceneSerializer.js');
const worldEditor = read('src/3d/editor/worldEditor.js');
const materializer = read('scripts/materializeRun216ServiceWorkerCache.js');

const modules = [
  'EditorClipboardController.js',
  'EditorEditModeEnvironment.js',
  'EditorRoadController.js',
  'EditorTerrainPaintController.js'
];
for (const moduleName of modules) {
  const tag = `<script type="module" src="./src/3d/editor/${moduleName}"></script>`;
  if ((html.split(tag).length - 1) !== 1) throw new Error(`${moduleName} must be wired exactly once`);
}

if (!environment.includes('api.scene.fog = null;')) throw new Error('Edit Mode fog disable contract missing');
if (!clipboard.includes("copyButton.textContent = 'Kopyala';")) throw new Error('real copy control missing');
if (!clipboard.includes("pasteButton.textContent = 'Yapıştır';")) throw new Error('real paste control missing');
if (!clipboard.includes("duplicateButton.textContent = 'Çoğalt';")) throw new Error('duplicate relabel contract missing');
if (!clipboard.includes("key === 'c'") || !clipboard.includes("key === 'v'") || !clipboard.includes("key === 'd'")) throw new Error('clipboard keyboard shortcuts incomplete');

const buildingCount = (library.match(/category: 'Bina'/g) || []).length;
if (buildingCount !== 8) throw new Error(`Expected 8 optimized building assets, found ${buildingCount}`);
if (!library.includes("id: 'editor-road-segment'")) throw new Error('road asset missing');
if (!library.includes("id: 'editor-land-cell'")) throw new Error('land asset missing');
if (!library.includes("id: 'editor-water-cell'")) throw new Error('water asset missing');
if (!manager.includes("asset.primitive === 'road-segment'")) throw new Error('road primitive renderer missing');
if (!manager.includes("asset.primitive === 'land-cell'")) throw new Error('land primitive renderer missing');
if (!manager.includes("asset.primitive === 'water-cell'")) throw new Error('water primitive renderer missing');
if (!manager.includes('water.userData.editorNoShadow = true;')) throw new Error('transparent water shadow safety missing');

if (!roads.includes("drawButton.textContent = 'Yol Çiz';")) throw new Error('road draw UI missing');
if (!roads.includes('api.editableObjects.push(object);')) throw new Error('road segments do not join persistent editable objects');
for (const mode of ['land-add', 'land-remove', 'water-add', 'water-remove']) {
  if (!terrain.includes(`'${mode}'`)) throw new Error(`terrain mode missing: ${mode}`);
}
if (!roads.includes('window.__WESTEROS_EDITOR_TERRAIN__')) throw new Error('road-to-terrain arbitration missing');
if (!terrain.includes('window.__WESTEROS_EDITOR_ROADS__')) throw new Error('terrain-to-road arbitration missing');

if (!serializer.includes('asset: object.userData.editorAssetId')) throw new Error('normal object asset persistence missing');
if (!worldEditor.includes('const asset = findEditorAsset(record.asset);')) throw new Error('normal object asset load path missing');
if (!worldEditor.includes('object.rotation.set(...record.transform.rotation);')) throw new Error('rotation round-trip missing');
if (!worldEditor.includes('object.scale.set(...record.transform.scale);')) throw new Error('scale round-trip missing');

const offlineModules = [
  'EditorTransformControls.js',
  'EditorScaleInputController.js',
  'EditorAssetScalePolicy.js',
  'EditorRoadModel.js',
  'EditorRoadController.js',
  'EditorTerrainCellModel.js',
  'EditorTerrainPaintController.js',
  'EditorClipboardController.js',
  'EditorEditModeEnvironment.js'
];
for (const moduleName of offlineModules) {
  if (!materializer.includes(`'./src/3d/editor/${moduleName}'`)) throw new Error(`PWA materializer missing ${moduleName}`);
}

for (const source of [clipboard, roads, terrain]) {
  if (!source.includes('@media(max-width:900px)')) throw new Error('mobile toolbar visibility contract missing');
  if (!source.includes("listen(window, 'pagehide', dispose, { once: true });")) throw new Error('controller pagehide cleanup contract missing');
}

console.log('PASS Run216 editor authoring contract: fog-free edit mode, copy/paste/duplicate, 8 buildings, roads, land/sea add-remove, persistence, mobile visibility, arbitration and PWA dependencies are wired.');
