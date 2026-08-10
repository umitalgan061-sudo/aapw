'use strict';

const fs = require('fs');

const html = fs.readFileSync('editor.html', 'utf8');
const library = fs.readFileSync('src/3d/editor/editorAssetLibrary.js', 'utf8');
const manager = fs.readFileSync('src/3d/editor/EditorAssetManager.js', 'utf8');
const model = fs.readFileSync('src/3d/editor/EditorTerrainCellModel.js', 'utf8');
const controller = fs.readFileSync('src/3d/editor/EditorTerrainPaintController.js', 'utf8');
const serializer = fs.readFileSync('src/3d/editor/EditorSceneSerializer.js', 'utf8');
const worldEditor = fs.readFileSync('src/3d/editor/worldEditor.js', 'utf8');
const materializer = fs.readFileSync('scripts/materializeRun216ServiceWorkerCache.js', 'utf8');

const moduleScript = '<script type="module" src="./src/3d/editor/EditorTerrainPaintController.js"></script>';
if ((html.split(moduleScript).length - 1) !== 1) throw new Error('EditorTerrainPaintController module script must be wired exactly once');
if (!library.includes("id: 'editor-land-cell'")) throw new Error('land cell asset missing');
if (!library.includes("id: 'editor-water-cell'")) throw new Error('water cell asset missing');
if (!library.includes("primitive: 'land-cell'")) throw new Error('land cell primitive missing');
if (!library.includes("primitive: 'water-cell'")) throw new Error('water cell primitive missing');
if (!manager.includes("asset.primitive === 'land-cell'")) throw new Error('land renderer missing');
if (!manager.includes("asset.primitive === 'water-cell'")) throw new Error('water renderer missing');
if (!manager.includes('EDITOR_TERRAIN_CELL_POLICY.landSurfaceOffsetMeters')) throw new Error('land offset policy not shared');
if (!manager.includes('EDITOR_TERRAIN_CELL_POLICY.waterSurfaceOffsetMeters')) throw new Error('water offset policy not shared');
if (!manager.includes('water.userData.editorNoShadow = true;')) throw new Error('transparent water no-shadow marker missing');
if (!manager.includes('if (child.userData.editorNoShadow)')) throw new Error('water no-shadow traversal override missing');
if (!manager.includes('child.castShadow = false;')) throw new Error('water cast-shadow disable missing');
if (!manager.includes('child.receiveShadow = false;')) throw new Error('water receive-shadow disable missing');
if (!model.includes('defaultCellSizeMeters: DEFAULT_TERRAIN_CELL_SIZE_METERS')) throw new Error('terrain cell size policy missing');
for (const mode of ['land-add', 'land-remove', 'water-add', 'water-remove']) {
  if (!controller.includes(`'${mode}'`)) throw new Error(`terrain mode missing: ${mode}`);
}
if (!controller.includes("api.scene.getObjectByName('Editor Ground')")) throw new Error('terrain paint must raycast editor ground');
if (!controller.includes("listen(api.canvas, 'pointerdown', onCanvasPointerDown, true);")) throw new Error('terrain paint must capture before legacy selection');
if (!controller.includes('event.stopImmediatePropagation();')) throw new Error('terrain paint must yield legacy selection while active');
if (!controller.includes('snapEditorTerrainCell(groundPoint, cellSize())')) throw new Error('terrain add must use deterministic cell snapping');
if (!controller.includes('const opposite = existingCell(oppositeAsset.id, cell);')) throw new Error('land/water overlap prevention missing');
if (!controller.includes('terrainObjectUnderPointer(assetId)')) throw new Error('terrain remove must raycast real painted cells');
if (!controller.includes('object.scale.set(cell.size, 1, cell.size);')) throw new Error('terrain metric cell scaling missing');
if (!controller.includes('api.editableObjects.push(object);')) throw new Error('terrain cell must join normal editable objects');
if (!serializer.includes('asset: object.userData.editorAssetId')) throw new Error('scene serializer asset persistence contract missing');
if (!worldEditor.includes('const asset = findEditorAsset(record.asset);')) throw new Error('scene loader asset rehydration contract missing');
if (!worldEditor.includes('object.scale.set(...record.transform.scale);')) throw new Error('scene loader terrain cell size persistence missing');
if (!controller.includes('@media(max-width:900px)')) throw new Error('terrain toolbar mobile visibility guard missing');
if (!materializer.includes("'./src/3d/editor/EditorTerrainCellModel.js'")) throw new Error('terrain model missing from PWA materializer');
if (!materializer.includes("'./src/3d/editor/EditorTerrainPaintController.js'")) throw new Error('terrain controller missing from PWA materializer');

console.log('PASS Run216 land/sea editor: add/remove modes, deterministic metric cells, overlap exclusion, transparent-water shadow safety, scene persistence, mobile and PWA contracts present.');
