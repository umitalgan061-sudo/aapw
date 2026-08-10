import assert from 'node:assert/strict';
import fs from 'node:fs';
import { EDITOR_ASSETS, findEditorAsset } from '../src/3d/editor/editorAssetLibrary.js';
import { computeEditorAssetImportScale } from '../src/3d/editor/EditorAssetScalePolicy.js';

const EXPECTED_BUILDINGS = Object.freeze([
  ['castle_icebound_citadel_decimated', 'assets/models/settlements/castles/icebound_citadel_decimated.glb'],
  ['castle_walled_city_fortress_decimated', 'assets/models/settlements/castles/walled_city_fortress_decimated.glb'],
  ['castle_fortress_of_the_crown_decimated', 'assets/models/settlements/castles/fortress_of_the_crown_decimated.glb'],
  ['castle_castle_on_a_rock_decimated', 'assets/models/settlements/castles/castle_on_a_rock_decimated.glb'],
  ['castle_emerald_citadel_decimated', 'assets/models/settlements/castles/emerald_citadel_decimated.glb'],
  ['castle_greystone_castle_decimated', 'assets/models/settlements/castles/greystone_castle_decimated.glb'],
  ['castle_brickstone_citadel_decimated', 'assets/models/settlements/castles/brickstone_citadel_decimated.glb'],
  ['castle_reference_gatehouse_decimated', 'assets/models/settlements/castles/gatehouse_reference_decimated.glb']
]);

const ids = EDITOR_ASSETS.map((asset) => asset.id);
assert.equal(new Set(ids).size, ids.length, 'editor asset ids must remain unique');

const buildings = EDITOR_ASSETS.filter((asset) => asset.category === 'Bina');
assert.equal(buildings.length, EXPECTED_BUILDINGS.length, 'editor must expose exactly the eight verified optimized castle buildings');

const serviceWorker = fs.readFileSync('service-worker.js', 'utf8');
for (const [id, src] of EXPECTED_BUILDINGS) {
  const asset = findEditorAsset(id);
  assert.ok(asset, `missing editor building ${id}`);
  assert.equal(asset.category, 'Bina', `${id} must stay in Bina category`);
  assert.equal(asset.format, 'glb', `${id} must use GLB`);
  assert.equal(asset.src, src, `${id} source drifted`);
  assert.equal(asset.instancing, false, `${id} must remain individually editable`);
  assert.equal(asset.targetMaxDimension, 46, `${id} must share gameplay castle scale target`);
  assert.ok(src.endsWith('_decimated.glb'), `${id} must use the optimized decimated asset`);
  assert.ok(fs.existsSync(src), `building asset missing from checkout: ${src}`);
  assert.ok(serviceWorker.includes(`'./${src}'`), `building asset missing from offline shell: ${src}`);
  assert.equal(computeEditorAssetImportScale(asset, 10), 4.6, `${id} must normalize small-authored models to 46m`);
  assert.equal(computeEditorAssetImportScale(asset, 100), 0.46, `${id} must normalize large-authored models to 46m`);
}

console.log('PASS Run216 editor buildings: 8 optimized castle GLBs, unique IDs, gameplay-aligned 46m normalization, individual editing and PWA cache coverage.');
