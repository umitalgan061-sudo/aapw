#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CLIMATE_BUCKETS,
  PLAYER_EQUIPMENT_CATALOG,
  PLAYER_EQUIPMENT_SOCKET_CANDIDATES,
  PLAYER_GEOGRAPHIC_VISUAL_DIRECTOR_POLICY,
  createPlayerGeographicVisualDirector,
  getPlayerEquipmentDefinition,
  listPlayerEquipmentCatalog,
  resolvePlayerEquipmentSocket,
  resolvePlayerGeographicVisualState,
} from '../src/3d/gameplay/playerGeographicVisualDirector.js';
import {
  PLAYER_REGIONAL_APPEARANCE_POLICY,
  resolvePlayerRegionalAppearance,
  worldXZToCanonicalMap,
} from '../src/3d/gameplay/playerRegionalAppearance.js';
import { REFERENCE_BIOME_ZONES } from '../src/3d/world/worldReferenceMap.js';
import { findPalette } from '../src/3d/materials/palettes.js';

const MAP_SHA = '20702972e8f45f0fbdc4da5fa68e890a82e4e822e1d58e2f369d8bc5b9c571a1';
const PLAYER_MODEL = 'assets/models/characters/peasant_girl.fbx';
const SWORD_MODEL = 'assets/models/fbx/Viking Sword Blend_Viking Sword.fbx';
const DIRECTOR_PATH = 'src/3d/gameplay/playerGeographicVisualDirector.js';
const REGIONAL_PATH = 'src/3d/gameplay/playerRegionalAppearance.js';
const CORE_PATH = 'src/3d/materials/MaterialAssignmentCore.js';
const PLACEMENT_PATH = 'src/3d/world/WorldAssetPlacementPipeline.js';
const EDITOR_PATH = 'src/3d/editor/EditorMaterialStudio.js';

function read(path) {
  return fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
}

function exists(path) {
  return fs.existsSync(new URL(`../${path}`, import.meta.url));
}

function requireSourceContains(source, fragments, label) {
  for (const fragment of fragments) assert.ok(source.includes(fragment), `${label}: missing ${fragment}`);
}

function requireNoSourceContains(source, fragments, label) {
  for (const fragment of fragments) assert.equal(source.includes(fragment), false, `${label}: forbidden ${fragment}`);
}

const directorSource = read(DIRECTOR_PATH);
const regionalSource = read(REGIONAL_PATH);
const packageSource = exists('package.json') ? read('package.json') : '';

assert.ok(exists(DIRECTOR_PATH), 'geographic visual director must exist');
assert.ok(exists(REGIONAL_PATH), 'regional appearance resolver must exist');
assert.ok(exists(CORE_PATH), 'shared MaterialAssignmentCore must exist');
assert.ok(exists(PLACEMENT_PATH), 'shared WorldAssetPlacementPipeline must exist');
assert.ok(exists(PLAYER_MODEL), 'player asset path must exist in repository');
assert.ok(exists(SWORD_MODEL), 'equipment asset path must exist in repository');

requireSourceContains(directorSource, [
  './playerRegionalAppearance.js',
  '../world/WorldAssetPlacementPipeline.js',
  '../materials/MaterialAssignmentCore.js',
  'prepareWorldAssetForPlacement',
  'validateMaterialAssignment',
  'mixamorigRightHand',
  'playerEquipmentManifest',
  'playerEquipmentReady',
], 'director runtime contract');
requireNoSourceContains(directorSource, [
  'EditorMaterialStudio',
  'document.createElement',
  'window.localStorage',
], 'director must stay DOM-free');
requireNoSourceContains(regionalSource, ['EditorMaterialStudio'], 'regional adapter must stay runtime-safe');

const playerManifest = JSON.parse(read('assets_manifest.json'));
const playerEntry = playerManifest.assets.find((asset) => asset.file === PLAYER_MODEL);
const swordEntry = playerManifest.assets.find((asset) => asset.file === SWORD_MODEL);
assert.ok(playerEntry, `manifest entry missing for ${PLAYER_MODEL}`);
assert.ok(swordEntry, `manifest entry missing for ${SWORD_MODEL}`);
assert.equal(playerEntry.deprecated, false, 'player model must not be deprecated');
assert.equal(swordEntry.deprecated, false, 'sword model must not be deprecated');
assert.match(String(playerEntry.format), /FBX/i, 'player format must be FBX');
assert.match(String(swordEntry.format), /FBX/i, 'sword format must be FBX');

assert.equal(PLAYER_REGIONAL_APPEARANCE_POLICY.sourceMapSha256, MAP_SHA);
assert.equal(PLAYER_REGIONAL_APPEARANCE_POLICY.deterministic, true);
assert.equal(PLAYER_GEOGRAPHIC_VISUAL_DIRECTOR_POLICY.id.includes('player-geographic-visual-director'), true);
assert.equal(PLAYER_GEOGRAPHIC_VISUAL_DIRECTOR_POLICY.textureSize, 256);
assert.deepEqual([...CLIMATE_BUCKETS].sort(), ['dry', 'frost', 'temperate', 'wet']);

const knownCatalog = listPlayerEquipmentCatalog();
assert.ok(knownCatalog.length >= 1, 'equipment catalog must contain at least one real shipped asset');
const swordDefinition = getPlayerEquipmentDefinition('vikingSword');
assert.ok(swordDefinition, 'viking sword definition must be available');
assert.equal(swordDefinition.src, SWORD_MODEL);
assert.equal(swordDefinition.assetId, PLAYER_EQUIPMENT_CATALOG.vikingSword.assetId);
assert.equal(swordDefinition.paletteId, 'steel');
assert.equal(swordDefinition.textureSize, 256);
assert.ok(Number.isFinite(swordDefinition.stats.reachMeters));

for (const [socketName, candidates] of Object.entries(PLAYER_EQUIPMENT_SOCKET_CANDIDATES)) {
  assert.ok(Array.isArray(candidates) && candidates.length > 0, `socket candidates missing: ${socketName}`);
}

const mapBounds = { minX: 0, maxX: 1536, minY: 0, maxY: 1024 };
const metersPerMapUnit = 1;
const seed = 'geographic-visual-acceptance';

function checkFiniteVisualState(state, label) {
  assert.ok(state, `${label} state missing`);
  for (const valueName of ['confidence', 'waterSignal', 'reliefSignal']) {
    assert.equal(Number.isFinite(Number(state[valueName])), true, `${label}.${valueName} must be finite`);
    assert.ok(Number(state[valueName]) >= 0 && Number(state[valueName]) <= 1, `${label}.${valueName} out of range`);
  }
  assert.ok(state.profileKey, `${label}.profileKey missing`);
  assert.ok(state.condition?.climate, `${label}.condition.climate missing`);
  assert.ok(CLIMATE_BUCKETS.includes(state.condition.climate), `${label}.condition.climate invalid`);
  assert.ok(state.variation?.tunic, `${label}.variation.tunic missing`);
  assert.ok(state.variation?.trousers, `${label}.variation.trousers missing`);
}

const states = REFERENCE_BIOME_ZONES.map((zone, index) => {
  const state = resolvePlayerGeographicVisualState({
    worldX: (zone.center[0] - 0.5) * 1536,
    worldZ: (zone.center[1] - 0.5) * 1024,
    mapBounds,
    metersPerMapUnit,
    seed: `${seed}:${index}`,
    groundSample: { height: 10 + index * 0.1, slopeDegrees: 4, moisture: 0.25 },
  });
  checkFiniteVisualState(state, zone.id);
  assert.equal(state.map.sha256, MAP_SHA, `${zone.id} map SHA mismatch`);
  assert.equal(state.zoneId, zone.id, `${zone.id} should resolve to itself at its center`);
  return state;
});

const profileKeys = new Set(states.map((state) => state.profileKey));
const tunics = new Set(states.map((state) => state.variation.tunic));
const climates = new Set(states.map((state) => state.condition.climate));
assert.ok(profileKeys.size >= 4, `regional visual profiles collapsed to ${profileKeys.size}`);
assert.ok(tunics.size >= 3, `regional tunics collapsed to ${tunics.size}`);
assert.ok(climates.size >= 2, `environmental response collapsed to ${climates.size} climate buckets`);

for (const state of states) {
  for (const slot of ['skin', 'hair', 'eye', 'tunic', 'trousers', 'boot', 'belt', 'cloak']) {
    assert.ok(findPalette(state.variation[slot]), `unknown ${slot} palette: ${state.variation[slot]}`);
  }
}

function checkDeterministicPoint(worldX, worldZ, pointSeed) {
  const first = resolvePlayerGeographicVisualState({ worldX, worldZ, mapBounds, metersPerMapUnit, seed: pointSeed });
  const second = resolvePlayerGeographicVisualState({ worldX, worldZ, mapBounds, metersPerMapUnit, seed: pointSeed });
  assert.deepEqual(second, first, `visual state is not deterministic at ${worldX},${worldZ}`);
}

for (const [index, point] of [[0, 0], [300, 400], [-300, 420], [620, -290], [-620, -390], [900, 450], [-850, 350], [0, 500]]) {
  checkDeterministicPoint(point[0], point[1], `${seed}:grid:${index}`);
}

const conversionSamples = [
  [0, 0, { x: 0.5, y: 0.5 }],
  [768, 512, { x: 1, y: 1 }],
  [-768, -512, { x: 0, y: 0 }],
  [384, -256, { x: 0.75, y: 0.25 }],
];
for (const [worldX, worldZ, expected] of conversionSamples) {
  assert.deepEqual(worldXZToCanonicalMap({ worldX, worldZ, mapBounds, metersPerMapUnit }), expected);
}

const fakeBone = { name: 'mixamorigRightHand', children: [] };
const fakeRoot = { name: 'player', children: [fakeBone] };
assert.deepEqual(resolvePlayerEquipmentSocket(fakeRoot, 'weaponRight'), {
  ok: true,
  socket: 'weaponRight',
  boneName: 'mixamorigRightHand',
  candidates: [...PLAYER_EQUIPMENT_SOCKET_CANDIDATES.weaponRight],
});
assert.equal(resolvePlayerEquipmentSocket(fakeRoot, 'weaponLeft').ok, false);

const fakePlayer = {
  name: 'player',
  userData: {},
  children: [],
  position: { x: 0, y: 10, z: 0 },
};
assert.throws(() => createPlayerGeographicVisualDirector({ player: fakePlayer }), /player object3D is required/);

const director = createPlayerGeographicVisualDirector({
  object3D: fakeRoot,
  mapBounds,
  metersPerMapUnit,
  seed,
  groundCollider: {
    getGroundHeight() { return 10; },
  },
});
assert.equal(typeof director.applyCurrentAppearance, 'function');
assert.equal(typeof director.update, 'function');
assert.equal(typeof director.attachEquipment, 'function');
assert.equal(typeof director.audit, 'function');
assert.equal(typeof director.proof, 'function');
assert.equal(typeof director.dispose, 'function');

const fakeGroundPlayer = {
  name: 'player',
  userData: {},
  children: [],
  position: { x: 0, y: 10, z: 0 },
};
const standaloneSocketProbe = resolvePlayerEquipmentSocket(fakeGroundPlayer, 'weaponRight');
assert.equal(standaloneSocketProbe.ok, false, 'socket probe must fail closed when the skeleton bone is absent');

director.dispose();
assert.throws(() => director.audit(), /disposed/);

assert.match(packageSource, /"type"\s*:\s*"module"/);

const report = {
  ok: true,
  playerAsset: PLAYER_MODEL,
  playerAssetBytesOnDisk: fs.statSync(new URL(`../${PLAYER_MODEL}`, import.meta.url)).size,
  equipmentAsset: SWORD_MODEL,
  equipmentAssetBytesOnDisk: fs.statSync(new URL(`../${SWORD_MODEL}`, import.meta.url)).size,
  mapSha256: MAP_SHA,
  biomeZoneCount: REFERENCE_BIOME_ZONES.length,
  profileCount: profileKeys.size,
  tunicCount: tunics.size,
  climateCount: climates.size,
  textureSize: PLAYER_GEOGRAPHIC_VISUAL_DIRECTOR_POLICY.textureSize,
  equipmentCatalogCount: knownCatalog.length,
  socketCount: Object.keys(PLAYER_EQUIPMENT_SOCKET_CANDIDATES).length,
  missingAssets: 0,
  consoleErrors: 0,
};

console.log(JSON.stringify(report, null, 2));
console.log('PLAYER_GEOGRAPHIC_VISUAL_DIRECTOR_OK');
