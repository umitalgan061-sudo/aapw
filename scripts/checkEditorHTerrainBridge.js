import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const fail = (message) => { throw new Error(`[checkEditorHTerrainBridge] ${message}`); };

const seed = JSON.parse(read('godot/terrain-authoring/editor_bridge/map_reference_seed.json'));
if (seed.schema !== 'westeros-hterrain-editor-v1') fail('schema drift');
if (seed.mapReferenceSha256 !== '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1') fail('map.png SHA drift');
if (seed.referenceCanvas?.width !== 9000 || seed.referenceCanvas?.height !== 7000) fail('reference canvas drift');
if (seed.hterrainResolution !== 513 || seed.mapLocked !== true || seed.applyMapReference !== true) fail('HTerrain map-lock contract drift');
if (seed.biomeZones?.length !== 17) fail(`expected 17 canonical biome zones, got ${seed.biomeZones?.length}`);
if (seed.reliefChains?.length !== 4) fail(`expected 4 canonical relief chains, got ${seed.reliefChains?.length}`);
if (!Array.isArray(seed.strokes) || seed.strokes.length !== 0) fail('seed strokes must remain empty');

const worldReference = read('src/3d/world/worldReferenceMap.js');
for (const zone of seed.biomeZones) {
  if (!worldReference.includes(`id: '${zone.id}'`)) fail(`seed biome not present in world reference: ${zone.id}`);
}
for (const chain of seed.reliefChains) {
  if (!worldReference.includes(`id: '${chain.id}'`)) fail(`seed relief chain not present in world reference: ${chain.id}`);
}

const editor = read('src/3d/editor/EditorLiveWorldResourceCleanup.js');
for (const marker of [
  "const HTERRAIN_EDITOR_SCHEMA = 'westeros-hterrain-editor-v1'",
  "MAP.PNG KİLİDİ · AÇIK",
  'worldXZToNormalizedReference(',
  'REFERENCE_BIOME_ZONES',
  'REFERENCE_RELIEF_CHAINS',
  "anchor.download = 'westeros-hterrain-authoring.json'",
  'window.__WESTEROS_EDITOR_HTERRAIN__ = surface',
  'mapLocked: true',
  'hterrainResolution: HTERRAIN_RESOLUTION'
]) {
  if (!editor.includes(marker)) fail(`editor contract missing: ${marker}`);
}

const serializer = read('src/3d/editor/EditorSceneSerializer.js');
for (const marker of [
  "const HTERRAIN_SURFACES = new Set(['auto', 'grass', 'earth', 'rock', 'snow'])",
  'hterrainSurface:',
  'elevationMeters:',
  'Scene terrain metadata obje olmalı.',
  'Desteklenmeyen HTerrain surface:'
]) {
  if (!serializer.includes(marker)) fail(`scene serializer HTerrain persistence missing: ${marker}`);
}

const worldEditor = read('src/3d/editor/worldEditor.js');
for (const marker of [
  'record.terrain.hterrainSurface',
  'object.userData.editorHTerrainSurface = surface',
  'object.userData.editorTerrainElevationMeters = elevation'
]) {
  if (!worldEditor.includes(marker)) fail(`scene load HTerrain persistence missing: ${marker}`);
}

const importer = read('godot/terrain-authoring/scripts/import_editor_hterrain_manifest.gd');
for (const marker of [
  'EXPECTED_SCHEMA := "westeros-hterrain-editor-v1"',
  'EXPECTED_MAP_SHA := "20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1"',
  'CHANNEL_HEIGHT',
  'CHANNEL_SPLAT',
  'mapLocked',
  '_apply_map_reference',
  '_apply_strokes',
  '_copy_passthrough_maps',
  'data.save_data(output)',
  'HTERRAIN_EDITOR_IMPORT_OK'
]) {
  if (!importer.includes(marker)) fail(`Godot importer contract missing: ${marker}`);
}

const rebaker = read('godot/terrain-authoring/scripts/rebake_editor_hterrain_derived.gd');
for (const marker of [
  'HTerrainNormalMapBaker',
  'HTerrainGlobalMapBaker',
  'terrain.set_data(generated)',
  'normal_baker.set_terrain_data(generated)',
  'request_tiles_in_region',
  'CHANNEL_NORMAL',
  'CHANNEL_GLOBAL_ALBEDO',
  'global_baker.bake(terrain)',
  'generated.save_data(output)',
  'HTERRAIN_EDITOR_DERIVED_REBAKE_OK'
]) {
  if (!rebaker.includes(marker)) fail(`Godot derived rebake contract missing: ${marker}`);
}

const lineCaps = [
  ['EditorLiveWorldResourceCleanup.js', editor],
  ['EditorSceneSerializer.js', serializer],
  ['worldEditor.js', worldEditor],
  ['import_editor_hterrain_manifest.gd', importer],
  ['rebake_editor_hterrain_derived.gd', rebaker]
];
for (const [name, source] of lineCaps) {
  const lines = source.split(/\r?\n/).length;
  if (lines > 600) fail(`${name} exceeded 600-line cap: ${lines}`);
}

console.log('[checkEditorHTerrainBridge] PASS: map.png lock + 17 biome zones + 4 relief chains + 513² editor/Godot authored+derived chain + scene persistence');
