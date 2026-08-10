'use strict';

const fs = require('fs');

const html = fs.readFileSync('editor.html', 'utf8');
const library = fs.readFileSync('src/3d/editor/editorAssetLibrary.js', 'utf8');
const manager = fs.readFileSync('src/3d/editor/EditorAssetManager.js', 'utf8');
const model = fs.readFileSync('src/3d/editor/EditorRoadModel.js', 'utf8');
const controller = fs.readFileSync('src/3d/editor/EditorRoadController.js', 'utf8');
const serializer = fs.readFileSync('src/3d/editor/EditorSceneSerializer.js', 'utf8');
const worldEditor = fs.readFileSync('src/3d/editor/worldEditor.js', 'utf8');
const materializer = fs.readFileSync('scripts/materializeRun216ServiceWorkerCache.js', 'utf8');

const moduleScript = '<script type="module" src="./src/3d/editor/EditorRoadController.js"></script>';
if ((html.split(moduleScript).length - 1) !== 1) throw new Error('EditorRoadController module script must be wired exactly once');
if (!library.includes("id: 'editor-road-segment'")) throw new Error('persistent road segment asset missing');
if (!library.includes("category: 'Yol'")) throw new Error('road asset category missing');
if (!library.includes("primitive: 'road-segment'")) throw new Error('road segment primitive contract missing');
if (!manager.includes("asset.primitive === 'road-segment'")) throw new Error('road primitive renderer missing');
if (!manager.includes('EDITOR_ROAD_POLICY.defaultWidthMeters')) throw new Error('road renderer does not share model width policy');
if (!manager.includes('EDITOR_ROAD_POLICY.verticalOffsetMeters')) throw new Error('road renderer does not share vertical offset policy');
if (!model.includes('defaultWidthMeters: DEFAULT_EDITOR_ROAD_WIDTH_METERS')) throw new Error('road model width policy missing');
if (!controller.includes("const ROAD_ASSET_ID = 'editor-road-segment';")) throw new Error('road controller asset ownership missing');
if (!controller.includes("api.scene.getObjectByName('Editor Ground')")) throw new Error('road controller must raycast editor ground');
if (!controller.includes("listen(api.canvas, 'pointerdown', onCanvasPointerDown, true);")) throw new Error('road drawing must capture pointer before legacy selection');
if (!controller.includes('event.stopImmediatePropagation();')) throw new Error('road drawing must yield legacy selection while active');
if (!controller.includes('object.quaternion.setFromUnitVectors(localXAxis, direction.normalize());')) throw new Error('road segment direction alignment missing');
if (!controller.includes('object.scale.set(length, 1, 1);')) throw new Error('road segment length scaling missing');
if (!controller.includes('api.editableObjects.push(object);')) throw new Error('road segment must join normal editable object collection');
if (!controller.includes('api.scene.add(object);')) throw new Error('road segment must join editor scene');
if (!controller.includes('undoLastSegment')) throw new Error('road undo contract missing');
if (!controller.includes('@media(max-width:900px)')) throw new Error('road toolbar mobile visibility guard missing');
if (!serializer.includes('asset: object.userData.editorAssetId')) throw new Error('scene serializer asset persistence contract missing');
if (!worldEditor.includes('const asset = findEditorAsset(record.asset);')) throw new Error('scene loader asset rehydration contract missing');
if (!worldEditor.includes('object.rotation.set(...record.transform.rotation);')) throw new Error('scene loader rotation persistence missing');
if (!worldEditor.includes('object.scale.set(...record.transform.scale);')) throw new Error('scene loader scale persistence missing');
if (!materializer.includes("'./src/3d/editor/EditorRoadModel.js'")) throw new Error('road model missing from PWA materializer');
if (!materializer.includes("'./src/3d/editor/EditorRoadController.js'")) throw new Error('road controller missing from PWA materializer');

console.log('PASS Run216 editor road controller: live ground drawing, deterministic segment transform, undo, normal scene persistence, mobile visibility and PWA cache contracts present.');
